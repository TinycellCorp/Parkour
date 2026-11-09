import Device from "../../../framework/core/Device";
import { evt } from "../../../framework/core/event";
import gUtil from "../../../framework/core/gUtil";
import Fx from "../../../framework/extension/fxplayer/Fx";
import FxPlayer from "../../../framework/extension/fxplayer/FxPlayer";
import Platform from "../../../framework/extension/Platform";
import { AdManager, AdType } from "../../../framework/Hi5/AdManager";
import LabelAnim from "../../../framework/extension/qanim/LabelAnim";
import ProgressBarAnim from "../../../framework/extension/qanim/ProgressBarAnim";
import { Loading } from "../../../framework/ui/LoadingManager";
import mvcView from "../../../framework/ui/mvcView";
import { Toast } from "../../../framework/ui/ToastManager";
import ccUtil from "../../../framework/utils/ccUtil";
import { LocalizationManager } from "../../../framework/Hi5/Localization/LocalizationManager";
import LoadingScene from "../common/LoadingScene";
import { ParkourType, pdata } from "../data/PlayerInfo";
import { root } from "../game/Game";
import Guide, { guider } from "../game/Guide";
import { Res, ResType } from "../game/model/BaseData";
import LevelData from "../game/model/LevelData";
import PlayerData from "../game/model/PlayerData";
import QualityLevelData from "../game/model/QualityLevelData";
import InventoryUI from "../view/TopMostInventoryUI";
import { heroSpinePaths } from "../common/HeroSpinePaths";

const { ccclass, property } = cc._decorator;

interface LootItemData {
    type: ResType,
    id?: number;
    num: number;
    is_lvup_reward?: boolean;
}

/**
 * 영웅별 스파인 스케일 설정
 * 기본값 1.0, 필요에 따라 각 영웅별 크기 조절
 */
const heroScales: { [heroId: string]: number } = {
    "1": 0.55,   // 춘식이
    "2": 0.55,   // 라이언
    "3": 0.55,   // 프로도
    "4": 0.55,   // 어피치
    "5": 0.45,   // 제이지
    "6": 0.4,  // 튜브 (크기가 커서 축소)
    "7": 0.5,   // 무지
    "8": 0.55,   // 네오
};

@ccclass
export default class UIEndPage extends mvcView {
    @property(cc.Node)
    newRecord: cc.Node = null;

    @property(cc.Node)
    btn_triple: cc.Node = null;

    @property(cc.Node)
    btn_next: cc.Node = null;

    @property(cc.Label)
    lab_gold: cc.Label = null;

    @property(cc.Label)
    lab_exp: cc.Label = null;


    @property(cc.Label)
    lab_score: cc.Label = null;

    @property(cc.ProgressBar)
    bar_exp: cc.ProgressBar = null;

    @property(cc.Layout)
    layout_lootlist: cc.Layout = null;

    @property(cc.Node)
    node_close: cc.Node = null;

    @property(cc.Node)
    node_btn_boxtip: cc.Node = null;

    @property(sp.Skeleton)
    roleModel: sp.Skeleton = null;

    @property(cc.Label)
    lab_level: cc.Label = null;

    @property(cc.Node)
    endlessHint: cc.Node = null;

    private isNewRecord: boolean = false;

    private goldNum: number = 100;

    private extraGold: number = 100;

    private expNum: number = 100;

    // 보상 지급 완료 플래그 (3배 보상 받으면 기존 보상 중복 지급 방지)
    private rewardClaimed: boolean = false;

    @property(cc.Node)
    node_success: cc.Node = null;

    anim: cc.Animation = null;

    tmp: cc.Node = null;

    /** 자랑하기 버튼 (prefab 의 k/right/btn_share). 다른 버튼과 동일하게 결과 연출 후 노출. */
    private btnShare: cc.Node = null;
    /** 카카오 환경 여부 (자랑하기는 카카오 전용). */
    private shareAvailable: boolean = false;

    static instance: UIEndPage


    onLoad() {
        this.anim = this.getComponentInChildren(cc.Animation)
        this.onVisible(this.newRecord, () => this.isNewRecord);
        this.register(this.lab_gold, () => this.goldNum);
        this.onClick(this.btn_triple, this.click_triple);
        this.onClick(this.btn_next, this.click_next);
        this.onClick(this.node_btn_boxtip, this.click_boxtip);
        this.onClick(this.node_close, this.click_close);

        // btn_share (자랑하기) — 카카오 자랑하기(showoff01) 바인딩. 라벨은 로컬라이징, 카카오 환경에서만 노출.
        //   노출 타이밍은 다른 버튼과 동일하게 cutBtnStyle(결과 연출 후)에서 처리 → 여기선 초기 숨김.
        this.btnShare = cc.find("k/right/btn_share", this.node);
        if (this.btnShare) {
            const shareLabel = this.btnShare.getComponentInChildren(cc.Label);
            if (shareLabel) {
                // 키값("@btn.share")을 넣고 localizeLabel 로 변환 + _localizationKey 등록(언어 변경 시 자동 갱신).
                shareLabel.string = "@btn.share";
                LocalizationManager.localizeLabel(shareLabel);
            }
            this.onClick(this.btnShare, this.click_share);
            try {
                const kakaoSdk = require("../../../framework/Hi5/business/kakaoSdk");
                this.shareAvailable = !!(kakaoSdk && kakaoSdk.isKakao && kakaoSdk.isKakao());
            } catch (e) { this.shareAvailable = false; }
            this.btnShare.active = false;   // 결과 연출 후 cutBtnStyle 에서 노출
        }

        this.updateHeroSpine(pdata.selHero);
        this.tmp = this.layout_lootlist.node.children[0]
        this.tmp.active = false;
        UIEndPage.instance = this;
    }

    start() {
        this.render();
    }

    onShow() {
        Device.playSfx(csv.Audio.sfx_gameWin);
        // 보상 지급 플래그 초기화
        this.rewardClaimed = false;

        if (pdata.gameMode == ParkourType.Normal) {
            if (pdata.isGameWin) {
                this.node_success.active = true;
            }
        }
        this.lab_level.string = "" + pdata.playerlv;

        // btn_next 텍스트를 게임 모드에 따라 설정
        const btnLabel = this.btn_next.getComponentInChildren(cc.Label);
        if (btnLabel) {
            if (pdata.gameMode == ParkourType.Infinite) {
                btnLabel.string = LocalizationManager.getText("@Fail.continue");
            } else {
                btnLabel.string = LocalizationManager.getText("@receive.normal");
            }
        }

        this.anim.play()
        this.cleanup();
        this.cutBtnStyle(false);
        this.scheduleOnce(this.showResult, 1)
        // CompletePlay 로그는 pdata.endGame() (모든 종료 경로의 단일 지점) 에서 처리 — 여기선 발사하지 않음(중복 방지).
    }

    cutBtnStyle(b: boolean) {
        this.btn_next.active = b;
        this.btn_triple.active = b;
        this.node_close.active = b;
        // 자랑하기: 카카오 환경 + "무한모드"에서만 노출 (일반 스테이지 모드 제외). 리더보드 점수와 동일 조건.
        if (this.btnShare) {
            this.btnShare.active = b && this.shareAvailable && (pdata.gameMode == ParkourType.Infinite);
            if (!b && this.shareAvailable && pdata.gameMode == ParkourType.Infinite) {
                // 결과 연출 동안 상위 % 를 미리 받아 둔다(클릭 시 조회하면 공유 창이 막힘)
                try { require("../../../framework/Hi5/business/kakaoSdk").prefetchShareTopPercent(); } catch (e) { }
            }
        }
    }

    onUpgradePlayLv() {
        this.lab_level.string = "" + pdata.playerlv;
    }

    onHidden() {
        //todo  
    }

    items_tobeAdded: LootItemData[] = []

    cleanup() {
        let children = this.layout_lootlist.node.children
        children.filter(v => v != this.tmp).forEach(v => v.destroy())
        this.lab_exp.string = Math.floor(pdata.expPercent * 100) + "%"
        // this.bar_exp.progress = pdata.expPercent;
    }

    click_boxtip() {
        Toast.make(LocalizationManager.getText("@text.upgrade_extra_reward"));
        // Toast.make("每次升级将会额外获得奖励!")
    }

    /** 자랑하기 — 카카오 SDK 템플릿 공유(showoff01). score = 이번 판 점수(tmpScore, 리더보드와 동일 값). */
    click_share() {
        Device.playSfx(csv.Audio.btn_click);
        const score = pdata.tmpScore;
        console.log("[UIEndPage] click_share tapped, score=", score);
        try {
            const kakaoSdk = require("../../../framework/Hi5/business/kakaoSdk");
            if (!(kakaoSdk && kakaoSdk.isKakao && kakaoSdk.isKakao())) {
                console.warn("[UIEndPage] share skip — not kakao");
                return;
            }
            const p = kakaoSdk.shareTemplate("showoff01", { score: score });
            if (p && p.then) {
                p.then((res: any) => {
                    console.log("[UIEndPage] shareTemplate 결과:", JSON.stringify(res));
                }).catch((e: any) => console.warn("[UIEndPage] shareTemplate 예외:", e));
            }
        } catch (e) {
            console.warn("[UIEndPage] kakao share 예외:", e);
        }
    }

    async addLootItems(items: LootItemData[], interval = 0.1) {
        // 템플릿 노드를 복제하여 사용
        // 주의: LocalizationManager.instantiatePrefab()은 cc.Node를 받으면 복제하지 않고 그대로 반환함
        // 따라서 cc.instantiate()로 직접 복제 후 로컬라이징 적용
        let tmp = this.tmp;
        for (let i = 0; i < items.length; i++) {
            let itemd = items[i]
            //仅支持金币和钻石2种资源 ，
            if (ResType[itemd.type] == null) {
                console.warn("Unknown resource type");
                continue;
            }
            if (Math.floor(itemd.num) <= 0) continue;
            this.items_tobeAdded.push(itemd);
            // cc.instantiate로 노드 복제 후 로컬라이징 적용
            let loot = cc.instantiate(tmp);
            LocalizationManager.localizeNode(loot);
            loot.active = true;
            let fx = loot.getComponentInChildren(FxPlayer);
            let icon = ccUtil.find("icon", loot, cc.Sprite)
            let label = ccUtil.find("label", loot, cc.Label)
            let rewardTip = cc.find("blinkText", loot)
            rewardTip.active = itemd.is_lvup_reward;
            ccUtil.setDisplay(icon, Res.getIconPath(itemd.type, itemd.id)).then(v => {
                ccUtil.clampSize(icon.node, 80, 80)
            })
            let n = Math.floor(itemd.num)
            label.string = "+" + n
            loot['data'] = itemd;
            loot.parent = this.layout_lootlist.node;
            this.layout_lootlist.updateLayout();
            fx.play();
            await evt.sleepSafe(this, interval)
        }
    }

    async showResult() {
        let lv_before = pdata.playerlv;
        let data = ccUtil.get(PlayerData, lv_before)

        this.items_tobeAdded.splice(0)
        let isThisLevelPlayed = pdata.getMaxScore(pdata.playinglv) > 0;
        let multi = 1;
        if (isThisLevelPlayed) {
            multi = 0.5;
        }
        let score = pdata.tmpScore;
        let labelAnim = gUtil.getOrAddComponent(this.lab_score, LabelAnim)
        await labelAnim.play(0.3, 0, score)
        this.isNewRecord = pdata.breakNewRecord();
        this.render();

        // get items ,游戏中获得+ 等级分数加成 (합산하여 표시)
        let totalGold = pdata.tmpGold * multi + score * 0.01 * multi;
        await this.addLootItems([{ type: ResType.Gold, num: totalGold }]);

        if (this.isNewRecord && csv.Config.NewRecordReward_Diamond > 0) {
            //如果是新记录则给一定 数量 的钻石 ，由Config.csv配置 
            await this.addLootItems([{ type: ResType.Diamond, num: csv.Config.NewRecordReward_Diamond }]);
        }

        //get exp  formular 
        let qualityData = ccUtil.get(QualityLevelData, pdata.selHeroData.quality)
        let expGain = Math.floor(0.1 * pdata.distance + pdata.playerlv * qualityData.values[pdata.selHeroLevel - 1])
        if (pdata.gameMode == ParkourType.Normal) {
            //关卡模式 额外经验值 算法
            let expInNormalMode = (200 + pdata.playinglv * 100)
            expGain += expInNormalMode;
        }
        expGain *= multi;
        // get exp current percentage 
        let expRatio = pdata.expPercent;
        let addExpRatio = expGain / pdata.reuquireExp;
        // let barAnim = gUtil.getOrAddComponent(this.bar_exp, ProgressBarAnim)
        let labelExpAnim = gUtil.getOrAddComponent(this.lab_exp, LabelAnim)
        labelExpAnim.templateStr = "%s%"
        let nextExp = Math.min(1, expRatio + addExpRatio)
        Device.playSfx(csv.Audio.sfx_addgemOrGold);
        labelExpAnim.play(0.3, Math.floor(expRatio * 100), Math.floor(nextExp * 100))
        // await barAnim.play(0.3, expRatio, nextExp)
        pdata.exp += expGain;
        // levelup 
        let ret = pdata.upPlayer();

        if (ret == "succ") {
            this.onUpgradePlayLv();
            expRatio = pdata.expPercent;
            labelExpAnim.play(0.3, 0, Math.floor(expRatio * 100));
            // await barAnim.play(0.3, 0, pdata.expPercent)
            // Toast.make("获得升级奖励!")
            // add lvup-reward-item to loot list
            await this.addLootItems([{ type: ResType.Diamond, num: data.diamond_reward, is_lvup_reward: true }, { type: ResType.Gold, num: data.gold_reward, is_lvup_reward: true }]);
            this.endlessHint.active = pdata.playerlv == 3;
        }
        if (pdata.gameMode == ParkourType.Normal) {
            // 过关
            let lvdata = ccUtil.get(LevelData, pdata.playinglv)
            let reward = lvdata.getReward()
            if (reward) {
                //过关奖励
                //前三关将连接新手引导 
                if (!isThisLevelPlayed) {
                    // 仅第一次可获取
                    await this.addLootItems([reward])
                }
            }
            if (pdata.level == pdata.playinglv && pdata.isGameWin) {
                // 关卡 +1
                pdata.level++;
                pdata.save("level");  // 즉시 저장
            }

            guider.finishLevel();

        } else {
            //无尽模式
            Platform.updateRank(pdata.score);
        }
        this.cutBtnStyle(true);

    }


    findLootItem(type, id) {
        return this.layout_lootlist.node.children.find(v => {
            let data = v['data'] as LootItemData
            //pet_hatch :4 
            if (data == null) return false;
            return data.type == type && data.id == id;
        })
    }

    /**
     * 타입만으로 루트 아이템 찾기 (ID 무관)
     */
    findLootItemByType(type) {
        return this.layout_lootlist.node.children.find(v => {
            let data = v['data'] as LootItemData
            if (data == null) return false;
            return data.type == type;
        })
    }


    click_triple() {
        // this.node_close.active = false;
        this.btn_triple.active = false;
        // this.btn_next.active = false;
        AdManager.showRewardAd(AdType.TRIPLE_REWARD, (success) => {
            if (success) {
                this.getReward(3);
                // this.scheduleOnce(this.gotoNextLevel, 2);
            } else {
                // 광고 실패 시 버튼 복원
                this.node_close.active = true;
                this.btn_triple.active = true;
                this.btn_next.active = true;
            }
        });
    }

    click_close() {
        Device.playSfx(csv.Audio.btn_click);
        this.getReward()
        Loading.show(0.5);
        this.scheduleOnce(() => {
            LoadingScene.goto("Home")
        }, 0.5)
    }

    click_next() {

        this.getReward()
        this.node_close.active = false;
        this.btn_next.active = false;
        this.btn_triple.active = false;
        if (pdata.energy <= 0) {
            // Toast 제거 - 팝업이 이미 충분한 정보 제공
            vm.show("UIRedHeartShop", () => {
                vm.hide("UIRedHeartShop");
                this.scheduleOnce(this.gotoNextLevel, 2)
            }, () => {
                Loading.show(0.5);
                LoadingScene.goto("Home");
            })
            return
        }
        this.scheduleOnce(this.gotoNextLevel, 2)
    }

    gotoNextLevel() {
        if (pdata.gameMode == ParkourType.Normal) {
            pdata.playinglv++;
            let lvdata = ccUtil.get(LevelData, pdata.playinglv)
            if (lvdata == null || lvdata.segments.length <= 0) {
                //没有更多关卡
                Loading.show(0.5);
                this.scheduleOnce(() => {
                    LoadingScene.goto("Home", { msg: LocalizationManager.getText("@text.waitForMoreLevels") })
                    // LoadingScene.goto("Home", { msg: "可先进行无尽模式，请期待更多关卡！" })
                }, 0.5)
                return;
            }
        }
        LoadingScene.goto("Main", { type: "subEnergy" });
    }

    getReward(mul = 1) {
        // 이미 보상을 받았으면 중복 지급 방지
        if (this.rewardClaimed) {
            console.log("[UIEndPage] Reward already claimed, skipping");
            return;
        }
        this.rewardClaimed = true;

        for (let i = 0; i < this.items_tobeAdded.length; i++) {
            InventoryUI.instance.setTarget(this.layout_lootlist.node)
            let itmd = this.items_tobeAdded[i];
            if (itmd.type == ResType.Gold) {
                pdata.gold += Math.floor(itmd.num * mul)
            } else if (itmd.type == ResType.Diamond) {
                pdata.diamond += itmd.num * mul
            } else if (itmd.type == ResType.Prop) {
                let itmkey = csv.Prop.get(itmd.id).type;
                pdata.buffs[itmkey] += itmd.num * mul;
            } else if (itmd.type == ResType.Hero) {
                pdata.upHero(itmd.id)
            }
        }
        //同步数据到服务器
        pdata.sendToServer("level,normal_maxScores,energy,gold,diamond,playerlv,exp,buffs,heros")
    }

    /**
     * 영웅 ID에 맞는 스파인 데이터 로드 및 적용
     */
    private updateHeroSpine(heroId: string) {
        const spinePath = heroSpinePaths[heroId];

        if (!spinePath) {
            console.warn(`Hero spine path not found for hero ID: ${heroId}`);
            return;
        }

        cc.loader.loadRes(spinePath, sp.SkeletonData, (err, skeletonData: sp.SkeletonData) => {
            if (err) {
                console.error(`Failed to load hero spine: ${spinePath}`, err);
                return;
            }

            if (this.roleModel && skeletonData) {
                const scale = heroScales[heroId] || 0.5;
                this.roleModel.skeletonData = skeletonData;
                this.roleModel.setAnimation(0, "Idle", true);
            }
        });
    }

}
