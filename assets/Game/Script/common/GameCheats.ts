/**
 * GameCheats - 게임 치트 기능 모듈
 *
 * 사용법:
 *   GameCheats.init(); // Home 씬에서 초기화
 *
 * 치트 UI 활성화:
 *   - 데스크탑: Shift+Click
 *   - 모바일: 트리플 탭 (3번 연속 탭)
 */

import { pdata } from "../data/PlayerInfo";
import { Toast } from "../../../framework/ui/ToastManager";
import { root } from "../game/Game";
import { LocalizationManager } from "../../../framework/Hi5/Localization/LocalizationManager";

// 챌린지 모드 최대 레벨 (Level.csv 기준)
const MAX_LEVEL = 100;
// 플레이어 최대 레벨 (User.csv 기준)
const MAX_PLAYER_LEVEL = 70;

export default class GameCheats {
    private static initialized = false;

    /**
     * 치트 시스템 초기화
     * Home 씬 진입 시 한 번 호출
     */
    static init() {
        if (!CC_DEBUG) return;
        if (this.initialized) return;
        if (typeof cheat === 'undefined') {
            console.warn('[GameCheats] cheat.js가 로드되지 않았습니다.');
            return;
        }

        // 치트 UI 초기화
        cheat();

        // 상태라인 설정 (버전 정보 표시)
        cheat.statusline((opt) => {
            return [
                `Lv.${pdata.level}/${MAX_LEVEL}`,
                `💰${pdata.gold}`,
                `💎${pdata.diamond}`,
                `❤️${pdata.energy}`
            ];
        });

        // 치트 그룹 등록
        this.registerCurrencyCheats();
        this.registerLevelCheats();
        this.registerMiscCheats();
        this.registerIngameCheats();
        this.registerLocalizationCheats();

        this.initialized = true;
        console.log('[GameCheats] 초기화 완료');
    }

    /**
     * 재화 관련 치트
     */
    private static registerCurrencyCheats() {
        cheat.addGroup(['재화', '코인/다이아/에너지'], {
            '💰+10K': [() => {
                pdata.gold += 10000;
                pdata.save('gold');
                Toast.make('코인 +10,000');
                cheat.statusline.refresh();
            }, '코인 10,000 추가'],

            '💰+100K': [() => {
                pdata.gold += 100000;
                pdata.save('gold');
                Toast.make('코인 +100,000');
                cheat.statusline.refresh();
            }, '코인 100,000 추가'],

            '💎+100': [() => {
                pdata.diamond += 100;
                pdata.save('diamond');
                Toast.make('다이아 +100');
                cheat.statusline.refresh();
            }, '다이아 100 추가'],

            '💎+1000': [() => {
                pdata.diamond += 1000;
                pdata.save('diamond');
                Toast.make('다이아 +1,000');
                cheat.statusline.refresh();
            }, '다이아 1,000 추가'],

            '❤️ MAX': [() => {
                pdata.energy = 99;
                pdata.save('energy');
                Toast.make('에너지 MAX (99)');
                cheat.statusline.refresh();
            }, '에너지 99로 설정'],

            '💰💎 MAX': [() => {
                pdata.gold = 9999999;
                pdata.diamond = 99999;
                pdata.energy = 99;
                pdata.save('gold');
                pdata.save('diamond');
                pdata.save('energy');
                Toast.make('모든 재화 MAX!');
                cheat.statusline.refresh();
            }, '모든 재화 최대치']
        });
    }

    /**
     * 레벨 관련 치트
     */
    private static registerLevelCheats() {
        cheat.addGroup(['레벨', '챌린지 모드 레벨'], {
            '챌린지 모드 레벨+10': [() => {
                const newLevel = Math.min(pdata.level + 10, MAX_LEVEL);
                pdata.level = newLevel;
                pdata.save('level');
                Toast.make(`챌린지 모드 레벨 → ${newLevel}`);
                cheat.statusline.refresh();
            }, '챌린지 모드 현재 레벨 +10'],

            '챌린지 모드 레벨+50': [() => {
                const newLevel = Math.min(pdata.level + 50, MAX_LEVEL);
                pdata.level = newLevel;
                pdata.save('level');
                Toast.make(`챌린지 모드 레벨 → ${newLevel}`);
                cheat.statusline.refresh();
            }, '챌린지 모드 현재 레벨 +50'],

            '챌린지 모드 전체해금': [() => {
                pdata.level = MAX_LEVEL;
                pdata.save('level');
                Toast.make(`챌린지 모드 모든 레벨 해금! (${MAX_LEVEL})`);
                cheat.statusline.refresh();
            }, `챌린지 모드 모든 레벨 해금 (${MAX_LEVEL})`],

            '챌린지 모드 레벨 리셋': [() => {
                pdata.level = 1;
                pdata.save('level');
                Toast.make('챌린지 모드 레벨 1로 리셋');
                cheat.statusline.refresh();
            }, '챌린지 모드 레벨 1로 리셋'],

            '플레이어Lv+10': [() => {
                const newLevel = Math.min(pdata.playerlv + 10, MAX_PLAYER_LEVEL);
                pdata.playerlv = newLevel;
                pdata.save('playerlv');
                Toast.make(`플레이어 레벨 → ${newLevel}`);
                cheat.statusline.refresh();
            }, '플레이어 레벨 +10'],

            '플레이어Lv MAX': [() => {
                pdata.playerlv = MAX_PLAYER_LEVEL;
                pdata.save('playerlv');
                Toast.make(`플레이어 레벨 MAX (${MAX_PLAYER_LEVEL})`);
                cheat.statusline.refresh();
            }, `플레이어 레벨 ${MAX_PLAYER_LEVEL}`],

            '플레이어 레벨 리셋': [() => {
                 pdata.playerlv = 1;
                pdata.save('playerlv');
                Toast.make('플레이어 레벨 1로 리셋');
                cheat.statusline.refresh();
            }, '플레이어 레벨 1로 리셋'],
        });
    }

    /**
     * 기타 치트
     */
    private static registerMiscCheats() {
        cheat.addGroup(['기타', '영웅/펫/버프'], {
            '영웅 전체해금': [() => {
                for (let i = 1; i <= 8; i++) {
                    pdata.heros[i.toString()] = 1;
                }
                pdata.save('heros');
                Toast.make('모든 영웅 해금!');
            }, '모든 영웅 해금'],

            '영웅 MAX': [() => {
                for (let i = 1; i <= 8; i++) {
                    pdata.heros[i.toString()] = 10;
                }
                pdata.save('heros');
                Toast.make('모든 영웅 레벨 MAX!');
            }, '모든 영웅 레벨 10'],

            '펫 전체해금': [() => {
                for (let i = 1; i <= 11; i++) {
                    pdata.pets[i.toString()] = 1;
                }
                pdata.save('pets');
                Toast.make('모든 펫 해금!');
            }, '모든 펫 해금'],

            '펫 MAX': [() => {
                for (let i = 1; i <= 11; i++) {
                    pdata.pets[i.toString()] = 5;
                }
                pdata.save('pets');
                Toast.make('모든 펫 레벨 MAX!');
            }, '모든 펫 레벨 5'],

            '버프 +10': [() => {
                pdata.buffs.giant += 10;
                pdata.buffs.protect += 10;
                pdata.buffs.speed += 10;
                pdata.buffs.pet_hatch += 10;
                pdata.save('buffs');
                Toast.make('모든 버프 아이템 +10');
            }, '모든 버프 아이템 +10'],

            '능력 MAX': [() => {
                pdata.abilitys.lifeup = 10;
                pdata.abilitys.beanup = 10;
                pdata.save('abilitys');
                Toast.make('모든 능력 MAX!');
            }, '모든 능력 레벨 10'],

            '일일제한 리셋': [() => {
                pdata.freeDiamondCount = 3;
                pdata.freeDiamondDate = '';
                pdata.save('freeDiamondCount');
                pdata.save('freeDiamondDate');
                Toast.make('일일 다이아 광고 횟수 리셋');
            }, '무료 다이아 광고 횟수 리셋'],

            '🗑 데이터 초기화': [() => {
                if (!window.confirm('모든 저장 데이터(재화·레벨·영웅·펫·튜토리얼)를 지우고 처음부터 시작합니다. 계속할까요?')) return;
                // 카카오 쿠키 백업(kcb)이 부팅 때 쿠키에서 localStorage 를 되살리므로 clear() 가 아니라
                // removeItem 으로 하나씩 지운다(후킹된 removeItem 이 백업 쿠키도 같이 지움).
                const keys = new Set<string>();
                for (let i = 0; i < localStorage.length; i++) keys.add(localStorage.key(i) as string);
                const kcb = (window as any).__kakaoCookieBackup;
                try { if (kcb && kcb.dump) Object.keys(kcb.dump()).forEach(k => keys.add(k)); } catch (e) { }
                keys.delete('cheat-tab-mode');
                keys.forEach(k => { try { localStorage.removeItem(k); } catch (e) { } });
                // 새로고침 전 게임이 메모리 데이터를 다시 저장하지 못하게 막는다
                Storage.prototype.setItem = function () { };
                Toast.make('데이터 초기화 완료 — 다시 시작합니다');
                setTimeout(() => location.reload(), 300);
            }, '저장 데이터 전부 삭제 후 재시작(쿠키 백업 포함)']
        });
    }

    /**
     * 인게임 버프 치트 (게임 플레이 중에만 작동)
     */
    private static registerIngameCheats() {
        cheat.addGroup(['🎮인게임', '버프 아이템 (게임 중 사용)'], {
            '🏃대시': [() => {
                if (!root || !root.player) {
                    Toast.make('게임 중에만 사용 가능');
                    return;
                }
                root.player.buffSystem.startBuff('rush', 5);
                Toast.make('대시 발동! (5초)');
            }, '대시 버프 5초'],

            '💪거인화': [() => {
                if (!root || !root.player) {
                    Toast.make('게임 중에만 사용 가능');
                    return;
                }
                root.player.buffSystem.startBuff('strong', 5);
                Toast.make('거인화 발동! (5초)');
            }, '거인화 버프 5초'],

            '🧲자석': [() => {
                if (!root || !root.player || !root.pet) {
                    Toast.make('게임 중에만 사용 가능');
                    return;
                }
                root.pet.buffSystem.startBuff('magnet', 5);
                Toast.make('자석 발동! (5초)');
            }, '자석 버프 5초'],

            '💰골드': [() => {
                if (!root || !root.player) {
                    Toast.make('게임 중에만 사용 가능');
                    return;
                }
                root.player.buffSystem.startBuff('gold', 3);
                Toast.make('골드 발동! (3초)');
            }, '장애물→골드 3초'],

            '⭐별': [() => {
                if (!root || !root.player) {
                    Toast.make('게임 중에만 사용 가능');
                    return;
                }
                root.player.buffSystem.startBuff('star', 10);
                Toast.make('별 발동! (10초)');
            }, '콩→별 10초'],

            '🏆즉시클리어': [() => {
                if (!root || !root.player) {
                    Toast.make('게임 중에만 사용 가능');
                    return;
                }
                pdata.endGame(true);
                root.pause();
                vm.show("UIEndPage");
                Toast.make('맵 클리어!');
            }, '현재 맵 즉시 클리어']
        });
    }

    /**
     * 언어 변경 치트
     */
    private static registerLocalizationCheats() {
        cheat.addGroup(['🌐언어', '언어 변경'], {
            '🇰🇷한국어': [() => {
                LocalizationManager.setLanguage('ko');
                Toast.make('언어: 한국어');
            }, '한국어로 변경'],

            '🇺🇸English': [() => {
                LocalizationManager.setLanguage('en');
                Toast.make('Language: English');
            }, '영어로 변경'],

            '🇨🇳中文': [() => {
                LocalizationManager.setLanguage('cn');
                Toast.make('语言: 中文');
            }, '중국어로 변경'],

            '🔑키 모드': [() => {
                LocalizationManager.setLanguage('key');
                Toast.make('언어: 키 디버그 모드');
            }, '키값으로 표시 (디버그)']
        });
    }
}
