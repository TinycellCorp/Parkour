import { evt } from "../../../framework/core/event";
import gUtil from "../../../framework/core/gUtil";
import AliEvent from "../../../framework/extension/AliEvent";
import BuffSystem from "../../../framework/extension/buffs/BuffSystem";
import Platform from "../../../framework/extension/Platform";
import { UInfo } from "../../../framework/extension/weak_net_game/UInfo";
import WeakNetGame from "../../../framework/extension/weak_net_game/WeakNetGame";
import LoadingSceneBase from "../../../framework/misc/LoadingSceneBase";
import { pdata } from "../data/PlayerInfo";
import { ServerConfig } from "./ServerConfig";
import Hi5 from "../../../framework/Hi5/Hi5";
import { LocalizationManager } from "../../../framework/Hi5/Localization/LocalizationManager";
import ResolutionManager from "./ResolutionManager";

// 로딩씬 완료 직후 미리 올려둘 리소스 목록
// 게임 플로우 핵심 에셋만 포함 (동적 경로·CSV 의존 에셋 제외)
const PRELOAD_LIST: Array<{ url: string; type: typeof cc.Asset }> = [
    // 영웅 스파인 (HeroSpinePaths 전체 — Home 진입 즉시 필요)
    { url: "Textures/kakao/heros/01choonsik", type: sp.SkeletonData as any },
    { url: "Textures/kakao/heros/02Ryan",     type: sp.SkeletonData as any },
    { url: "Textures/kakao/heros/06Frodo",    type: sp.SkeletonData as any },
    { url: "Textures/kakao/heros/03Apeach",   type: sp.SkeletonData as any },
    { url: "Textures/kakao/heros/08Jay-G",    type: sp.SkeletonData as any },
    { url: "Textures/kakao/heros/04Tube",     type: sp.SkeletonData as any },
    { url: "Textures/kakao/heros/05Muzi",     type: sp.SkeletonData as any },
    { url: "Textures/kakao/heros/07Neo",      type: sp.SkeletonData as any },
    // 게임 플로우 핵심 UI prefab
    { url: "prefabs/UIReady",    type: cc.Prefab },
    { url: "prefabs/UIEndPage",  type: cc.Prefab },
    { url: "prefabs/UIFail",     type: cc.Prefab },
    { url: "prefabs/UIRevive",   type: cc.Prefab },
    // 게임 중 반복 재생되는 정적 오디오
    { url: "Audio/pick_bean", type: cc.AudioClip },
    { url: "Audio/eat_coin",  type: cc.AudioClip },
];

const { ccclass, property } = cc._decorator;

let inited = false;

// Hi5 SDK 플래그를 window 객체에 저장하여 씬 전환 시에도 유지
// (모듈이 다시 로드되어도 window 객체는 유지됨)
const getHi5Flag = (key: string, defaultValue: boolean = false): boolean => {
    if (typeof window !== 'undefined') {
        return (window as any)[`_hi5_${key}`] ?? defaultValue;
    }
    return defaultValue;
};
const setHi5Flag = (key: string, value: boolean): void => {
    if (typeof window !== 'undefined') {
        (window as any)[`_hi5_${key}`] = value;
    }
};

// Hi5 플랫폼 여부 확인
const isHi5Platform = () => {
    return Hi5 != null;
};

// Hi5 SDK 메시지 콜백 (모듈 레벨 - 씬 전환 후에도 유효)
const onHi5Message = (data) => {
    console.log("[Hi5] Message received:", data.fromhi5action, JSON.stringify(data));

    if (data.fromhi5action === Hi5.MESSAGE.GAME_DATA) {
        // 서버에서 게임 데이터 수신
        console.log("[Hi5] Game data loaded from server");
        setHi5Flag('hi5Initialized', true);

        // 카카오 한정: 가로 게임임을 호스트에 통보 → 네비(메인)메뉴 가로 배치 유도.
        // PlatFormData(platform)는 GAME_DATA 수신 시점에 이미 채워져 있음(Hi5._OnMessage).
        if (Hi5.getPlatform() === 'kakao' && !getHi5Flag('orientationSet')) {
            setHi5Flag('orientationSet', true);
            Hi5.setDeviceOrientation('landscape');
            console.log("[Hi5] setDeviceOrientation('landscape') called for kakao");
        }
    } else if (data.fromhi5action === Hi5.MESSAGE.START_GAME) {
        // 게임 시작 요청
        console.log("[Hi5] Start game requested");
        evt.emit("Hi5.StartGame");
    } else if (data.fromhi5action === Hi5.MESSAGE.RESTART_GAME) {
        // 게임 재시작 요청
        console.log("[Hi5] Restart game requested");
        evt.emit("Hi5.RestartGame");
    } else if (data.fromhi5action === Hi5.MESSAGE.SOUND) {
        // 사운드 설정
        console.log("[Hi5] Sound setting:", data.data);
        evt.emit("Hi5.Sound", data.data);
    } else if (data.fromhi5action === "LOAD_AD") {
        // 광고 로드 결과
        console.log("[Hi5] LOAD_AD message - status:", data.data.status);

        if (data.data.status === 0) {
            // 로드 성공 → showAd 호출
            console.log("[Hi5] Ad loaded, showing...");
            if (Hi5.lastAd) {
                Hi5.showAd(Hi5.lastAd);
            } else {
                // lastAd가 없으면 실패 처리
                console.error("[Hi5] LOAD_AD success but lastAd is null");
                Hi5.ShowAdEnd({ status: -1, type: "no_ad_object", success: false });
                cc.audioEngine.resumeMusic();
            }
        } else {
            // 로드 실패
            console.error("[Hi5] Ad load failed:", data.data.msg);
            Hi5.lastAd = undefined;  // 상태 정리

            // v1.0.12 콜백 방식 지원: 로드 실패 콜백 호출
            Hi5.ShowAdEnd({ status: data.data.status, type: "load_failed", success: false });

            // 레거시 이벤트 방식도 유지
            evt.emit("Hi5.AdResult", false);
            cc.audioEngine.resumeMusic();
        }
    } else if (data.fromhi5action === "SHOW_AD") {
        // Hi5 광고 메시지 처리
        console.log("[Hi5] SHOW_AD message - status:", data.data.status, "type:", data.data.type);

        if (data.data.status === 0) {
            const adType = data.data.type;

            if (adType === "show" || adType === "userEarnedReward") {
                // 광고가 표시되거나 보상을 받았을 때 - 플래그 설정
                Hi5.lastShowAd = true;
                console.log("[Hi5] Ad show/reward - lastShowAd set to true");
            } else if (adType === "dismissed") {
                // 광고가 닫혔을 때 - 콜백 호출
                const success = Hi5.lastShowAd;
                console.log("[Hi5] Ad dismissed - success:", success);

                // v1.0.12 콜백 방식 지원: AdManager.showRewardAd() 콜백 호출
                Hi5.ShowAdEnd({ status: 0, type: "dismissed", success: success });

                // 레거시 이벤트 방식도 유지
                evt.emit("Hi5.AdResult", !!success);
            }
        } else {
            // 광고 로드/표시 실패 (status !== 0)
            console.error("[Hi5] Ad show failed:", data.data.msg);

            // v1.0.12 콜백 방식 지원: 실패 콜백 호출
            Hi5.ShowAdEnd({ status: data.data.status, type: "failed", success: false });

            // 레거시 이벤트 방식도 유지
            evt.emit("Hi5.AdResult", false);
        }
    }
};

@ccclass
export default class LoadingScene extends LoadingSceneBase {

    @property(cc.Label)
    labelTip: cc.Label = null;

    private heartbeatTime: number = 0;

    private isLoadSucc: boolean = false;
    private hi5Initialized: boolean = false;

    // cc-preload 이중 완료 패턴
    private _loginReady: boolean = false;
    private _preloadReady: boolean = false;

    onLoad() {
        console.log("[LoadingScene] onLoad started");

        // 카카오/웹 빌드 GameCanvas 포커스 시 나타나는 주황 테두리(outline) 제거.
        // 최초 실행 씬(LoadingScene)에서 1회 <style> 주입 → 재빌드에도 코드로 유지됨.
        if (typeof document !== 'undefined' && !document.getElementById('__cc_no_outline__')) {
            var s = document.createElement('style'); s.id = '__cc_no_outline__';
            s.textContent = '#GameCanvas,#GameCanvas:focus,canvas,canvas:focus{outline:none!important;-webkit-tap-highlight-color:transparent;}';
            document.head.appendChild(s);
        }

        // 카카오 부팅 초기화 — 스플래시 해제.
        // kakaoSdk.ensureInit()는 광고/랭킹 호출 시점에만 lazy 실행되어,
        // 부팅 시 init이 안 끝나면 window.__hideKakaoSplash가 영영 호출되지 않아
        // 흰/검은 스플래시가 사라지지 않는 버그가 있었음.
        // 부팅(onLoad) 시점에 카카오 환경에서만 init을 강제 트리거하고,
        // 성공/실패 무관하게 스플래시를 해제한다.
        try {
            const _kakaoSdk = require("../../../framework/Hi5/business/kakaoSdk");
            if (_kakaoSdk && _kakaoSdk.isKakao && _kakaoSdk.isKakao()) {
                const _hideSplash = () => {
                    if (typeof window !== 'undefined' && (window as any).__hideKakaoSplash) {
                        (window as any).__hideKakaoSplash();
                    }
                };
                _kakaoSdk.ensureInit().then(_hideSplash).catch(_hideSplash);
            }
        } catch (e) {
            console.warn("[LoadingScene] kakao 부팅 init 예외:", e);
        }

        // TiledMap 컬링 비활성화 - 배경 타일이 화면 가장자리에서 갑자기 나타나는 것 방지
        // TMX 파일이 CSV 인코딩이어야 함 (zlib 압축 시 에러 발생)
        cc.macro.ENABLE_TILEDMAP_CULLING = false;

        super.onLoad();
        this.status = 1;

        // 해상도 관리자 초기화
        ResolutionManager.init();
        ResolutionManager.applyToCurrentScene();
        ResolutionManager.coverBackground(cc.find('Canvas/loading_background'), 1334, 750);
        console.log("[ResolutionManager] " + ResolutionManager.getDebugInfo());

        // Hi5 SDK 초기화
        this.initHi5SDK();

        // Hi5 스플래시 종료 - Loading 씬 로드 완료 시점에 호출 (한 번만 실행)
        if (isHi5Platform() && !getHi5Flag('loadEndCalled')) {
            setHi5Flag('loadEndCalled', true);
            Hi5.LoadEnd();
            console.log("[Hi5] LoadEnd called on Loading scene load");
        }

        // 로그인 대기와 병렬로 리소스 프리로드 시작
        this._startPreload();

        this.scheduleOnce(this.heartBeatReport, 2)
        console.log("[LoadingScene] onLoad finished");
    }

    // Hi5 SDK 초기화 (한 번만 실행)
    initHi5SDK() {
        // 이미 초기화된 경우 중복 초기화 방지
        // window 객체에 플래그를 저장하여 씬 전환/모듈 재로드 시에도 유지
        if (getHi5Flag('sdkInited')) {
            console.log("[Hi5] SDK already initialized, skipping");
            return;
        }
        setHi5Flag('sdkInited', true);
        console.log("[Hi5] initHi5SDK called");

        // 초기 게임 데이터 정의 (pdata 필드와 일치해야 함)
        const initialGameData = {
            high_score: 0,
            score: 0,
            // pdata 기본값들
            "pdata.playinglv": 1,
            "pdata.level": 1,
            "pdata.gold": 1000,
            "pdata.diamond": 1000,
            "pdata.playerlv": 1,
            "pdata.exp": 0,
            "pdata.heros": { "1": 1, "2": 1, "3": 1, "4": 1, "5": 1, "6": 1 },
            "pdata.selHero": "1",
            "pdata.pets": {},
            "pdata.selPet": "0",
            "pdata.energy": 5,
            "pdata.buffs": { giant: 0, protect: 0, speed: 0, pet_hatch: 0 },
            "pdata.abilitys": { lifeup: 1, beanup: 1 },
            "pdata.guides": { noob: 0, pet: 0, item: 0, hero: 0 },
            "pdata.energyRecoveryT": 0,
            "pdata.score": 0,
            "pdata.normal_maxScores": {},
            "pdata.signIn": { date: 1, isSignIn: false },
            "pdata.signInTime": 0,
            "pdata.showTimeRateAdd": 1,
            "pdata.save_timestamps": 0,
        };

        // Hi5 SDK 초기화 - 모듈 레벨 onHi5Message 콜백 사용
        // (씬 전환 시에도 콜백이 유효하도록 모듈 레벨에 정의됨)
        Hi5.Init_SDK(onHi5Message, initialGameData);
        console.log("[Hi5] SDK initialized");
    }


    heartBeatReport() {
        if (this.isLoadSucc || this.heartbeatTime >= 4) return;
        // AliEvent.aliEvent("loading", { "heart": (this.heartbeatTime + 1) * 2 });
        this.heartbeatTime++;
        this.scheduleOnce(this.heartBeatReport, 2)
    }

    // 로그인 완료 → 이중 완료 체크
    async nextScene() {
        this._loginReady = true;
        this._checkReady();
    }

    // 프리로드 진행 (Hi5.LoadEnd 직후 병렬 실행)
    private _startPreload(): void {
        const total = PRELOAD_LIST.length;
        if (total === 0) {
            this._onPreloadComplete();
            return;
        }
        let loaded = 0;
        for (const res of PRELOAD_LIST) {
            cc.loader.loadRes(res.url, res.type, (err, _asset) => {
                if (err) cc.warn('[Preload] failed: ' + res.url);
                if (++loaded >= total) {
                    this._onPreloadComplete();
                }
            });
        }
    }

    private _onPreloadComplete(): void {
        console.log('[Preload] all resources loaded');
        this._preloadReady = true;
        this._checkReady();
    }

    // 로그인 + 프리로드 둘 다 완료됐을 때만 씬 전환 (중복 호출 방지)
    private _sceneLaunched: boolean = false;
    private _checkReady(): void {
        if (!this._loginReady || !this._preloadReady) return;
        if (this._sceneLaunched) return;
        this._sceneLaunched = true;
        if (gUtil.isNextDay(UInfo.lastLoginTime)) {
            UInfo.lastLoginTime = Date.now();
            UInfo.isFirstLoginToday = true;
            UInfo.save("lastLoginTime")
        } else {
            UInfo.isFirstLoginToday = false;
        }
        //开始
        this.loadNextScene()
        // AliEvent.aliEvent("loading", { "statu": "finish" });
        evt.emit("Loading.Success")

        // Hi5 LoadEnd는 onLoad()에서 이미 호출됨 (스플래시 숨김)
    }
    //login 
    _status: number = 0;

    set status(v) {
        this._status = v;
        
        if (v == -1) {
            this.labelTip.string = LocalizationManager.getText("@loading.login_failed") || "로그인 실패"
        } else if (v == 1) {
            this.labelTip.string = LocalizationManager.getText("@loading.progress") || "로딩 중"
        } else {
            this.labelTip.string = LocalizationManager.getText("@loading.progress") || "로딩 중"
        }
    }


    click_retry() {

    }

    //csv config share_config complete
    loginProgress(evt, progressValue?: number) {

        switch (evt) {
            case 'login':
                this.labelTip.string = LocalizationManager.getText("@loading.login") || "로그인 중"
                this.progress = 0.9;
                break;
            case 'config':
                this.labelTip.string = LocalizationManager.getText("@loading.config") || "설정 로딩"
                this.progress = 0.1;
                break;
            case 'local_csv':
                this.labelTip.string = LocalizationManager.getText("@loading.config_local") || "로컬 설정 로딩"
                this.progress = 0.3;
                break;
            case "csv":
                this.labelTip.string = LocalizationManager.getText("@loading.config_network") || "네트워크 설정 로딩"
                // Use the detailed progress value if provided, otherwise use default 0.5
                this.progress = progressValue !== undefined ? progressValue : 0.5;
                break;
            case 'share_config':
                this.labelTip.string = LocalizationManager.getText("@loading.config_share") || "공유 설정 로딩"
                this.progress = 0.7;
                break;
            case "complete":
                this.labelTip.string = LocalizationManager.getText("@loading.entering") || "게임 진입 중..."
                this.progress = 1.0;
                break;
        }
    }

    finishLoad(data?) {
        this.isLoadSucc = true;
        // 后设置索引 
        csv.createIndex("Config", "key", "value")
        csv.createIndex("Audio", "key", "value")
        // WeakNetGame.is_safe_mode = !!csv.Config.Safe_Mode;
        inited = true;
        // check save timestamps 
        //sdk :设置 openid
        if (!data) {
            //登录失败，也进入
            this.nextScene();
            return;
        }
    }

    start() {
        console.log("[LoadingScene] start() called");
        //do init
        // GameLogic.doLogin().then(v=>this.onLoadCsvs())
        //提前下载配置文件
        // AliEvent.aliEvent("loading", { "statu": "start" });
        if (!inited) {
            console.log("[LoadingScene] Initializing WeakNetGame config");
            WeakNetGame.initConfig(ServerConfig);
            //第一进入游戏 的loading 界面
            if (!ServerConfig.is_local_game) {
                WeakNetGame.downloadCsv("Config").then(v => {
                    csv.createIndex("Config", "key", "value")
                })
            }
        }
        if (!inited) {
            console.log("[LoadingScene] Calling WeakNetGame.doLogin");
            WeakNetGame.doLogin(UInfo.userId, this.loginProgress.bind(this)).then(data => {
                this.finishLoad(data)
                let time = data.save_timestamps
                if (time) {
                    // openId 
                    if (data.openId == UInfo.userId) {
                        if (time > pdata.save_timestamps) {
                            //use server data 
                            pdata.loadFromJsonObject(data);
                        } else {
                            //로컬 데이터 사용
                            console.log("로컬 데이터 사용, 서버가 최신이 아님")
                        }
                    } else {
                        //다른 플레이어 게임 로그인 
                        UInfo.userId = data.openId;
                        UInfo.save("userId")
                        pdata.loadFromJsonObject(data);
                    }
                } else {
                    //신규 플레이어 로컬 데이터 사용
                    UInfo.isNew = true;
                    UInfo.userId = data.openId;
                    UInfo.save('userId')
                    console.log("신규 플레이어 로컬 데이터 사용----, 플레이어 ID 업데이트")
                }
                !data.stime && (data.stime = new Date().getTime());
                BuffSystem.time = data.stime / 1000;
                // util.checkIp()
                this.nextScene();
            }).catch(v => {
                this.finishLoad()
            })
        } else {
            this.nextScene();
        }

    }

}