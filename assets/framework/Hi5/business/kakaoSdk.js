/**
 * 카카오 SDK 헬퍼 (CC 2.4.13, npm @tinycellcorp/hi5-sdk 1.13.0).
 *
 * Parkour(49FriendRunner)는 기존에 framework/Hi5/Hi5.ts(커스텀 postMessage 브릿지)로
 * hi5games 플랫폼과 통신한다. package.json 의 @TinycellCorp/hi5-sdk 의존성은 실제로는
 * 사용되지 않았다(커스텀 브릿지가 모든 SDK 호출을 대체). 카카오 플랫폼은 KakaoAdapter(`/platform`
 * 엔트리)가 필수인데, CC2 빌더는 import 한 곳이 없으면 platform 을 번들에서 누락시킨다.
 * 따라서 카카오 동작(광고/랭킹)을 위해 npm @tinycellcorp/hi5-sdk 와 /platform 을 명시적으로 require 한다.
 *
 * ⚠ 로드 순서: regenerator-runtime → hi5-sdk(index) → (lazy) hi5-sdk/platform.
 *   platform.js 는 module-load 시 new _Hi5SDK() 로 window.parent 에 접근하므로
 *   top-level require 금지(에디터/비-kakao 로드 시 씬 깨짐). 런타임 kakao 호스트에서만 lazy require.
 *
 * 설정값(카카오 어드민 발급):
 *   - H5_ID         : h5Id (20756)
 *   - SERVER_TYPE   : 'qa'  (QA 백엔드. 실서비스 전환 시 'live')
 *   - LEADERBOARD_ID: 'ranking'
 *
 * 비카카오 환경에서는 모든 함수가 안전하게 no-op/빈결과 반환 → hi5games/일반 웹에서도 안전.
 */

require("../Hi5Helper_2x/regenerator-runtime");
var sdk = require("@tinycellcorp/hi5-sdk");
var adDiag = require("../ad-diag");

// === 카카오 어드민 발급값 ===
var H5_ID = "20756";
// 서버 타입 자동감지 — 호스트명 prefix 로 결정 (dev-→dev, qa-→qa, 그외→live).
//   동일 빌드를 QA/Live 양 도메인에 올려도 호스트명만으로 백엔드가 갈리도록 (수동 빌드 분기 제거).
function detectServerType(){ try{ var h=(typeof location!=="undefined"?location.hostname:"")||""; h=h.toLowerCase(); if(h.indexOf("dev-")===0) return "dev"; if(h.indexOf("qa-")===0) return "qa"; }catch(e){} return "live"; }
var SERVER_TYPE = detectServerType();
var LEADERBOARD_ID = "ranking";
// 화면 방향 — SDK start config 의 orientation 으로 전달(가로 게임).
//   SDK 기본값은 "portrait" 이고 어드민 미등록 시 세로로 떨어지므로, 코드에서 명시적으로 "landscape" 강제.
//   (어드민에 가로 등록돼 있어도 동일 값이라 충돌 없음.)
var ORIENTATION = "landscape";

var _adapter = null;
var _initPromise = null;
var _ready = false;

/**
 * toKakaoKafka 헤더 강제 true 패치 (log-internals.md §4).
 *   SDK 내부 Xe(type) 가 first_page/click_start/shop/player_action 등을 toKakaoKafka:false 로 보내
 *   HTTP 200 이어도 카카오 Kafka 미적재(어드민 미집계). /writeH5Log 요청의 헤더를 강제 true 로 덮어
 *   모든 로그 타입이 분석 대시보드에 집계되도록 함. window.__kakaoKafkaForced 가드로 1회만.
 */
function forceKakaoKafkaHeader() {
    if (typeof window === "undefined") return;
    if (window.__kakaoKafkaForced) return;
    window.__kakaoKafkaForced = true;
    var URL_MATCH = "/writeH5Log";
    try {
        if (typeof window.fetch === "function") {
            var origFetch = window.fetch.bind(window);
            window.fetch = function (input, init) {
                var url = typeof input === "string" ? input
                        : (typeof URL !== "undefined" && input instanceof URL) ? input.toString()
                        : (input && input.url) ? input.url : "";
                if (url && url.indexOf(URL_MATCH) !== -1) {
                    init = init || {};
                    try {
                        var headers = new Headers(init.headers || {});
                        headers.set("toKakaoKafka", "true");
                        init.headers = headers;
                    } catch (e) {}
                }
                return origFetch(input, init);
            };
        }
    } catch (e) { console.warn("[KakaoSDK] forceKakaoKafkaHeader fetch 패치 예외:", e); }
    try {
        if (typeof XMLHttpRequest !== "undefined") {
            var origOpen = XMLHttpRequest.prototype.open;
            var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.open = function (method, url) {
                this.__url = url;
                return origOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
                if (name === "toKakaoKafka" && this.__url && this.__url.indexOf(URL_MATCH) !== -1) {
                    return origSetHeader.call(this, name, "true");
                }
                return origSetHeader.call(this, name, value);
            };
        }
    } catch (e) { console.warn("[KakaoSDK] forceKakaoKafkaHeader XHR 패치 예외:", e); }
}

function isKakao() {
    try {
        if (sdk.detectPlatform && sdk.detectPlatform() === "kakao") return true;
        if (typeof location !== "undefined") {
            var h = (location.hostname || "").toLowerCase();
            if (/kakao/.test(h)) return true;
            var qs = location.search || "";
            if (/[?&](provider=kakao|kakaoH5Id=|h5Id=|code=)/i.test(qs)) return true;
        }
        if (typeof navigator !== "undefined" && /KAKAOTALK/i.test(navigator.userAgent || "")) return true;
    } catch (e) {}
    return false;
}

function isConfigured() {
    return !!H5_ID;
}

/** 카카오 어댑터 활성화 (멱등). 미설정/비카카오/모듈없음 → false. */
function ensureInit() {
    if (_ready) return Promise.resolve(true);
    if (_initPromise) return _initPromise;
    var kak = isKakao();
    if (!H5_ID || !kak || !sdk.async || !sdk.async.init) {
        console.log("[KakaoSDK] init 스킵 — H5_ID:" + !!H5_ID + " kakao:" + kak);
        return Promise.resolve(false);
    }
    // ad-diag/로그 오버레이 활성 플래그 영속화. ?logOverlay=true 쿼리는 카카오 OAuth redirect 후
    //   소실되므로 부팅 초입에서 localStorage 로 옮긴다. ⚠ Live 제외 — Live URL 에 쿼리를 붙여 디버깅하면
    //   그 origin 에 플래그가 영구히 남아 일반 유저에게 오버레이가 노출된다(qa-/dev- 는 접두라 통과).
    try {
        var _isLive = /(^|\.)gameplay\.game\.kakao\.com$/i.test((location && location.hostname) || "");
        if (!_isLive && /[?&]logOverlay=true\b/i.test((location && location.search) || "")) {
            localStorage.setItem("KAKAO_LOG_OVERLAY", "1");
        }
    } catch (e) { /* localStorage 불가 — 쿼리 있는 동안만 동작 */ }

    // toKakaoKafka 헤더 강제 패치 — 어댑터 생성/init 전(첫 로그 발사 전)에 1회 적용 (§4).
    forceKakaoKafkaHeader();
    // platform.js 는 여기서만 lazy require (런타임 kakao 호스트).
    var KakaoAdapter = null;
    try {
        KakaoAdapter = require("@tinycellcorp/hi5-sdk/platform").KakaoAdapter;
    } catch (e) {
        console.warn("[KakaoSDK] hi5-sdk-platform require 실패:", e);
        return Promise.resolve(false);
    }
    try {
        _adapter = new KakaoAdapter({ h5Id: H5_ID, serverType: SERVER_TYPE, orientation: ORIENTATION, adUnits: {
            // 미서빙 세부 슬롯 → base 유닛 통일 (성공작 Z-Pig 패턴). 1.8.0 platform.js 세부슬롯 default를 override.
            interstitial_result: { android: "DAN-ruHgApIXXPWWSOO0", ios: "DAN-aDL9z3VW5ahULFo7" },
            interstitial_save: { android: "DAN-ruHgApIXXPWWSOO0", ios: "DAN-aDL9z3VW5ahULFo7" },
            interstitial_ap: { android: "DAN-ruHgApIXXPWWSOO0", ios: "DAN-aDL9z3VW5ahULFo7" },
            reward_item: { android: "DAN-0Qhj8vQxudOr7LHg", ios: "DAN-Jxtxl9RjpOmnHOIf" },
            reward_continue: { android: "DAN-0Qhj8vQxudOr7LHg", ios: "DAN-Jxtxl9RjpOmnHOIf" },
            reward_daily_bonus: { android: "DAN-0Qhj8vQxudOr7LHg", ios: "DAN-Jxtxl9RjpOmnHOIf" },
            reward_outfit: { android: "DAN-0Qhj8vQxudOr7LHg", ios: "DAN-Jxtxl9RjpOmnHOIf" },
            reward_buff: { android: "DAN-0Qhj8vQxudOr7LHg", ios: "DAN-Jxtxl9RjpOmnHOIf" },
            reward_revive: { android: "DAN-0Qhj8vQxudOr7LHg", ios: "DAN-Jxtxl9RjpOmnHOIf" },
            reward_item_gain: { android: "DAN-0Qhj8vQxudOr7LHg", ios: "DAN-Jxtxl9RjpOmnHOIf" },
            reward_currency: { android: "DAN-0Qhj8vQxudOr7LHg", ios: "DAN-Jxtxl9RjpOmnHOIf" },
            reward_double: { android: "DAN-0Qhj8vQxudOr7LHg", ios: "DAN-Jxtxl9RjpOmnHOIf" },
            reward_ap_charge: { android: "DAN-0Qhj8vQxudOr7LHg", ios: "DAN-Jxtxl9RjpOmnHOIf" },
            reward_time_skip: { android: "DAN-0Qhj8vQxudOr7LHg", ios: "DAN-Jxtxl9RjpOmnHOIf" },
            reward_pet: { android: "DAN-0Qhj8vQxudOr7LHg", ios: "DAN-Jxtxl9RjpOmnHOIf" },
        } });
        console.log("[KakaoSDK] KakaoAdapter 생성:", { h5Id: H5_ID, serverType: SERVER_TYPE, orientation: ORIENTATION });
    } catch (e) {
        console.warn("[KakaoSDK] KakaoAdapter 생성 실패:", e);
        return Promise.resolve(false);
    }
    _initPromise = sdk.async.init(_adapter, function () { return Promise.resolve(); })
        .then(function (res) {
            _ready = !!(res && res.success);
            console.log("[KakaoSDK] init 응답:", res, "→ ready=" + _ready);
            return _ready;
        })
        .catch(function (e) { console.warn("[KakaoSDK] init 예외:", e); return false; });
    return _initPromise;
}

/** 전체 랭킹 → [{playerId, rank, score, nickname}] (실패 시 []) */
function getRankings(seasonSeq, beginRank, endRank) {
    var opts = { leaderboardId: LEADERBOARD_ID, seasonSeq: seasonSeq || 0, beginRank: beginRank || 1, endRank: endRank || 50 };
    return ensureInit().then(function (ok) {
        if (!ok) return [];
        return sdk.async.getRankings(opts).then(function (res) {
            if (!res || !res.success || !res.page) return [];
            return (res.page.rankingInfos || []).map(function (e) {
                return { playerId: e.playerId, rank: e.rank, score: e.score, nickname: (e.property && e.property.nickname) || "" };
            });
        }).catch(function (e) { console.warn("[KakaoSDK] getRankings 예외:", e); return []; });
    });
}

/** 내 랭킹 → {playerId, rank, score, nickname} (없으면 null) */
function getMyRanking(seasonSeq) {
    var opts = { leaderboardId: LEADERBOARD_ID, seasonSeq: seasonSeq || 0 };
    return ensureInit().then(function (ok) {
        if (!ok) return null;
        return sdk.async.getMyRanking(opts).then(function (res) {
            if (!res || !res.success || !res.ranking) return null;
            var r = res.ranking;
            return { playerId: r.playerId, rank: r.rank, score: r.score, nickname: (r.property && r.property.nickname) || "" };
        }).catch(function (e) { console.warn("[KakaoSDK] getMyRanking 예외:", e); return null; });
    });
}

/** 점수 제출. 성공 여부 boolean. */
function submitScore(score) {
    return ensureInit().then(function (ok) {
        if (!ok) return false;
        return sdk.async.submitScoreAsync({ leaderboardId: LEADERBOARD_ID, score: score })
            .then(function (res) { return !!(res && res.success); })
            .catch(function (e) { console.warn("[KakaoSDK] submitScore 예외:", e); return false; });
    });
}

/**
 * 광고 표시 (전면/리워드).
 * key: 'interstitial'(전면) | 'reward'(리워드). adUnit ID 는 KakaoAdapter 내부 DEFAULT_KAKAO_AD_UNITS 사용.
 * @returns {Promise<{success:boolean, rewarded?:boolean, error?:string, errorCode?:string}>}
 * @param {Function|{onEarned?:Function, onStarted?:Function}} [callbacks]
 *   - Function: 리워드 보상 획득 콜백(onEarned)으로 취급 (하위호환).
 *   - Object: { onEarned, onStarted }. onStarted 는 광고 로드 완료 후 실제 표시 직전 호출됨
 *     → 로딩 인디케이터를 네이티브 광고 표시 시점에 정확히 넘겨줄 때 사용.
 */
function showAd(key, callbacks) {
    var k = key || "interstitial";
    return ensureInit().then(function (ok) {
        if (!ok || !_adapter || typeof _adapter.showAd !== "function") {
            // 진단: 어댑터 미준비로 광고 자체를 못 부른 케이스도 실패로 남긴다(트리거 도달 여부 판별용).
            adDiag.log("ad_fail", { key: k, code: "not-ready" });
            return { success: false, error: "not-ready" };
        }
        // 진단 로그는 게임 내 모든 광고 호출이 지나는 이 단일 진입점에만 둔다.
        adDiag.log("ad_call", { key: k, plat: adDiag.platform(_adapter || sdk) });
        // 함수면 onEarned 단일 콜백, 객체면 {onEarned,onStarted} 그대로 전달 (KakaoAdapter.showAd 가 양형 모두 지원).
        return _adapter.showAd(k, callbacks)
            .then(function (res) {
                res = res || { success: false };
                if (res.success) adDiag.log("ad_success", { key: k, rewarded: res.rewarded });
                else adDiag.log("ad_fail", { key: k, code: res.errorCode || res.error || "unknown" });
                return res;
            })
            .catch(function (e) {
                console.warn("[KakaoSDK] showAd 예외:", e);
                adDiag.log("ad_fail", { key: k, code: String(e) });
                return { success: false, error: String(e) };
            });
    });
}

/**
 * 카카오 게임로그 — 임의 spec 이벤트 전송 (FirstPage/ClickStart/Shop 등).
 *   _adapter.sendLog(type, body) 직접 호출. 없으면 sdk.async.sendLog 대체.
 *   비카카오/미초기화 시 안전 no-op.
 */
function sendLog(type, body) {
    return ensureInit().then(function (ok) {
        if (!ok) return;
        try {
            if (_adapter && typeof _adapter.sendLog === "function") { _adapter.sendLog(type, body); return; }
            if (sdk.async && typeof sdk.async.sendLog === "function") { sdk.async.sendLog(type, body); }
        } catch (e) { console.warn("[KakaoSDK] sendLog 예외:", e); }
    });
}

/**
 * 게임 1판 시작 — StartPlay 매핑 + play_time 추적 시작.
 *   ⚠ _adapter.gameStart(body) 직접 호출 (최상위 sdk.async.gameStart 는 무인자).
 */
function gameStart(body) {
    return ensureInit().then(function (ok) {
        if (!ok || !_adapter || typeof _adapter.gameStart !== "function") return;
        try { _adapter.gameStart(body); } catch (e) { console.warn("[KakaoSDK] gameStart 예외:", e); }
    });
}

/**
 * 게임 1판 종료 — CompletePlay 매핑 (result/score/stage, play_time 자동).
 *   ⚠ _adapter.gameEnd(body) 직접 호출 (최상위 sdk.async.gameEnd 는 무인자라 result/score 버림).
 */
function gameEnd(body) {
    return ensureInit().then(function (ok) {
        if (!ok || !_adapter || typeof _adapter.gameEnd !== "function") return;
        try { _adapter.gameEnd(body); } catch (e) { console.warn("[KakaoSDK] gameEnd 예외:", e); }
    });
}

/**
 * 게임 1판 미완주 종료 — ExitPlay (result 미확정 이탈: 그만하기/타임아웃/방치 등).
 *   가이드 §5/§6 패턴:
 *     - play_time = _adapter.getPlayTime() (gameStart 후 경과 ms). ≤0 이면 플레이 중 아님 → no-op.
 *     - sendLog('exit_play', {reason, play_time}) 발사 (gameEnd 가 아니라 sendLog — result 없음).
 *     - 발사 직후 _adapter._playStartTime=0 리셋 → SDK beforeunload 자동핸들러의 중복 exit_play 차단.
 *   ⚠ 같은 판에 gameEnd() 와 동시 호출 금지(한 판 종료로그 1건). 호출처 isGameEnd 가드로 보장.
 */
function exitPlay(reason) {
    return ensureInit().then(function (ok) {
        if (!ok || !_adapter) return;
        try {
            var playTime = (typeof _adapter.getPlayTime === "function") ? _adapter.getPlayTime() : 0;
            if (!(playTime > 0)) return;   // 플레이 중 아님 (이중 가드)
            if (typeof _adapter.sendLog === "function") {
                _adapter.sendLog("exit_play", { reason: reason, play_time: playTime });
            } else if (sdk.async && typeof sdk.async.sendLog === "function") {
                sdk.async.sendLog("exit_play", { reason: reason, play_time: playTime });
            }
            // SDK 자동 beforeunload 핸들러 중복 발사 차단 — _playStartTime 리셋 (gameEnd 와 동일 효과).
            try { _adapter._playStartTime = 0; } catch (e) {}
        } catch (e) { console.warn("[KakaoSDK] exitPlay 예외:", e); }
    });
}

// 프리셋 기본 문구 (sdk.KAKAO_TOAST_MESSAGES 우선, 없으면 이 fallback).
var _TOAST_FALLBACK = {
    dataFee: "Wi-Fi가 아닌 환경에서는 데이터 요금이 발생할 수 있어요",
    adLoadFail: "광고를 불러올 수 없어요. 잠시 후 다시 시도해주세요",
    adSkipped: "광고를 끝까지 시청해야 보상을 받을 수 있어요",
    adSuccess: "보상 시청이 완료되어 보상을 지급했어요"
};

/**
 * 공용 카카오 토스트 (자체 렌더링 — 캔버스 기준 배치).
 *   window.__showKakaoToast(뷰포트 기준) 대신, 게임 캔버스 영역의 가로 중앙 + 하단 bottomPct 위치에 배치.
 *   → 카카오 웹뷰가 세로/레터박스여도 토스트가 게임 화면 안에 보이도록 보강. 캔버스 없으면 뷰포트 기준 fallback.
 * @param {string} text
 * @param {object} [options] fontSize/color/bg/radius/bottomPct/durationMs/maxWidth
 */
function showToast(text, options) {
    try {
        if (!text || typeof document === "undefined" || !document.body) return;
        var o = options || {};
        var bg = o.bg || "rgba(0,0,0,0.85)";
        var color = o.color || "#ffffff";
        var fontSize = o.fontSize != null ? o.fontSize : 14;
        var radius = o.radius != null ? o.radius : 12;
        var bottomPct = o.bottomPct != null ? o.bottomPct : 12;
        var durationMs = o.durationMs != null ? o.durationMs : 3000;
        var maxWidth = o.maxWidth != null ? o.maxWidth : 600;

        // 부모: 게임 컨테이너(cc.game.container)에 붙이면 Cocos 가 적용한 회전(rotate(90deg))을 그대로 상속한다.
        //   → 세로 웹뷰에서 게임만 가로로 회전돼도 토스트가 게임과 같은 방향/위치로 표시됨.
        //   transform 걸린 컨테이너는 absolute 자식의 컨테이닝 블록이 되므로 좌표가 컨테이너(=게임 화면) 기준.
        //   컨테이너 없으면 body + fixed(뷰포트 기준) fallback.
        var parent = document.body, posMode = "fixed";
        try {
            if (typeof cc !== "undefined" && cc.game && cc.game.container) { parent = cc.game.container; posMode = "absolute"; }
        } catch (e) {}

        var t = document.createElement("div");
        t.className = "kakao-toast-cc";
        t.textContent = text;
        t.style.cssText =
            "position:" + posMode + ";left:50%;bottom:" + bottomPct + "%;transform:translateX(-50%);" +
            "box-sizing:border-box;display:flex;align-items:center;justify-content:center;" +
            "padding:10px 18px;max-width:min(calc(100% - 32px)," + maxWidth + "px);white-space:nowrap;text-align:center;" +
            "font-size:" + fontSize + "px;line-height:1.3;color:" + color + ";background:" + bg + ";" +
            "border-radius:" + radius + "px;z-index:100000;pointer-events:none;opacity:0;transition:opacity 0.3s ease;";
        parent.appendChild(t);
        // 텍스트가 max-width 초과 시 줄바꿈 fallback.
        if (t.scrollWidth > t.clientWidth + 1) { t.style.whiteSpace = "normal"; t.style.wordBreak = "keep-all"; }

        var raf = (typeof requestAnimationFrame === "function") ? requestAnimationFrame : function (cb) { return setTimeout(cb, 16); };
        raf(function () { raf(function () { t.style.opacity = "1"; }); });
        setTimeout(function () { t.style.opacity = "0"; }, Math.max(0, durationMs - 300));
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, durationMs + 50);
    } catch (e) { console.warn("[KakaoSDK] showToast 예외:", e); }
}

/**
 * 프리셋 토스트 — 'dataFee' | 'adLoadFail' | 'adSkipped' | 'adSuccess'.
 * 문구는 sdk.KAKAO_TOAST_MESSAGES[preset] 우선, 없으면 내부 fallback.
 */
function showToastPreset(preset, options) {
    try {
        var msgs = (sdk && sdk.KAKAO_TOAST_MESSAGES) || _TOAST_FALLBACK;
        var text = msgs[preset] || _TOAST_FALLBACK[preset];
        if (text) showToast(text, options);
    } catch (e) { console.warn("[KakaoSDK] showToastPreset 예외:", e); }
}

/**
 * 카카오 템플릿 공유(자랑하기). templateCode 미지정 시 어댑터 기본('showoff01').
 * @param {string} templateCode 예: 'showoff01'
 * @param {object} [templateArgs] 템플릿 동적 인자 (예: { stage: 12 })
 * @returns {Promise<{success:boolean, error?:string}>}
 */
function shareTemplate(templateCode, templateArgs) {
    return ensureInit().then(function (ok) {
        if (!ok || !_adapter || typeof _adapter.shareTemplate !== "function") {
            return { success: false, error: "not-ready" };
        }
        return _adapter.shareTemplate({ templateCode: templateCode, templateArgs: templateArgs })
            .then(function (res) { return res || { success: false }; })
            .catch(function (e) { console.warn("[KakaoSDK] shareTemplate 예외:", e); return { success: false, error: String(e) }; });
    });
}

// 템플릿이 정의한 전역 토스트 훅을 캔버스 기준 구현으로 교체.
//   → 데이터요금 안내(스플래시 종료 시 _showDataFeeToast → window.__showKakaoToast)도 캔버스 기준 배치 적용.
//   kakaoSdk 는 부팅 시 LoadingScene 에서 require 되어 스플래시 종료(_actuallyHide) 전에 교체됨.
try {
    if (typeof window !== "undefined") window.__showKakaoToast = showToast;
} catch (e) {}

// SDK DOM 오버레이(네비메뉴 GNB 등)를 게임 컨테이너로 이동 → Cocos 회전(rotate(90deg)) 상속.
//   세로 웹뷰에서 게임만 가로로 회전돼도 GNB 가 게임과 같은 방향으로 표시되도록.
//   (토스트와 동일 기법. 광고는 네이티브 뷰라 여기서 못 다룸 — 네이티브 가로 필요.)
//   SDK 는 #sdk-gnb-overlay 를 body 에 동적 생성하므로 MutationObserver 로 감지해 이동.
function _reparentSdkOverlays() {
    try {
        if (typeof document === "undefined" || typeof MutationObserver === "undefined" || !document.body) return;
        if (window.__sdkOverlayReparentSet) return;
        window.__sdkOverlayReparentSet = true;
        var IDS = ["sdk-gnb-overlay"];
        // GNB 메뉴를 게임(가로) 우상단에 고정 + 내부 래퍼를 컨테이너 폭(100%)에 맞춤.
        //   SDK 기본 내부 div 는 width/height:100vw(세로 뷰포트 기준) 라 가로 컨테이너와 어긋남 → 100% 로 교정.
        var fixGnbLayout = function (el) {
            try {
                if (!el || el.id !== "sdk-gnb-overlay") return;
                var inner = el.querySelector("div");
                if (inner) { inner.style.width = "100%"; inner.style.height = "100%"; inner.style.inset = "0"; }
                var header = el.querySelector(".doc-header");
                if (header) {
                    header.style.top = "0"; header.style.left = "0"; header.style.right = "0";
                    header.style.width = "100%";
                }
                var ih = el.querySelector(".inner_header");
                if (ih) { ih.style.justifyContent = "flex-end"; }
                var wb = el.querySelector(".wrap_btn");
                if (wb) { wb.style.justifyContent = "flex-end"; }
            } catch (e) {}
        };
        var move = function (el) {
            try {
                if (!el || !el.parentNode) return;
                var c = (typeof cc !== "undefined" && cc.game && cc.game.container) ? cc.game.container : null;
                if (c && el.parentNode !== c) c.appendChild(el);
                fixGnbLayout(el);
            } catch (e) {}
        };
        IDS.forEach(function (id) { move(document.getElementById(id)); });
        var obs = new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                var added = muts[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var n = added[j];
                    if (n && n.nodeType === 1 && IDS.indexOf(n.id) !== -1) move(n);
                }
            }
        });
        obs.observe(document.body, { childList: true });
    } catch (e) { console.warn("[KakaoSDK] SDK 오버레이 reparent 설정 예외:", e); }
}
try {
    if (typeof window !== "undefined" && isKakao()) _reparentSdkOverlays();
} catch (e) {}

module.exports = {
    isKakao: isKakao,
    isConfigured: isConfigured,
    ensureInit: ensureInit,
    getRankings: getRankings,
    getMyRanking: getMyRanking,
    submitScore: submitScore,
    showAd: showAd,
    sendLog: sendLog,
    gameStart: gameStart,
    gameEnd: gameEnd,
    exitPlay: exitPlay,
    shareTemplate: shareTemplate,
    showToast: showToast,
    showToastPreset: showToastPreset,
    TOAST_MESSAGES: (sdk && sdk.KAKAO_TOAST_MESSAGES) || null,
    LEADERBOARD_ID: LEADERBOARD_ID
};
