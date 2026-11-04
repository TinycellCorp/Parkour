import Device from "../../../framework/core/Device";
import { evt } from "../../../framework/core/event";
import gUtil from "../../../framework/core/gUtil";
import BuffSystem from "../../../framework/extension/buffs/BuffSystem";
import FxPlayer from "../../../framework/extension/fxplayer/FxPlayer";
import { ITileObjectFactory } from "../../../framework/extension/tilemap/TmxLayerWalker";
import { UInfo } from "../../../framework/extension/weak_net_game/UInfo";
import { Loading } from "../../../framework/ui/LoadingManager";
import mvcView from "../../../framework/ui/mvcView";
import { Toast } from "../../../framework/ui/ToastManager";
import ccUtil from "../../../framework/utils/ccUtil";
import { LocalizationManager } from "../../../framework/Hi5/Localization/LocalizationManager";
import { ParkourType, pdata } from "../data/PlayerInfo";
import InventoryUI from "../view/TopMostInventoryUI";
import { guider } from "./Guide";
import PlayerData from "./model/PlayerData";
import { heroSpinePaths } from "../common/HeroSpinePaths";
import GameCheats from "../common/GameCheats";
import { keepInKakaoSafeArea } from "../../../framework/Hi5/KakaoSafeUI";

const { ccclass, property } = cc._decorator;

@ccclass
export default class Home extends mvcView {

    //ui_engergy
    @property(cc.Label)
    private lab_engergy: cc.Label = null;

    //ui_gold
    @property(cc.Label)
    private lab_gold: cc.Label = null;

    //ui_diamond
    @property(cc.Label)
    private lab_diamond: cc.Label = null;

    //ui_exe
    @property(cc.Label)
    private lab_exe: cc.Label = null;
    @property(cc.Label)
    private lab_LV: cc.Label = null;

    @property(cc.Node)
    drawBoxPoint: cc.Node = null;


    @property(cc.Node)
    node_loc: cc.Node = null;

    @property(sp.Skeleton)
    heroModel: sp.Skeleton = null;

    // 펫 모델 컨테이너 노드 (펫 prefab을 자식으로 추가)
    @property(cc.Node)
    petModel: cc.Node = null;

    @property(cc.Node)
    node_btn_pet: cc.Node = null;

    onLoad() {
        this.register(this.lab_engergy, _ => pdata.energy)
        this.register(this.lab_gold, _ => pdata.gold);
        this.register(this.lab_diamond, _ => pdata.diamond);
        this.register(this.lab_exe, _ => (pdata.expPercent * 100).toFixed() + "%");
        this.register(this.lab_LV, _ => pdata.playerlv);
        //等级大于3级解锁无尽模式
        this.onVisible(this.node_loc, _ => pdata.playerlv < csv.Config.Unlock_Endless)
        //
        this.onVisible(this.drawBoxPoint, () => {
            return UInfo.drawResidueTime > 0;
        })
        this.updateHeroSpine();
        evt.on("pdata.selHero", this.updateHeroSpine, this);
        this.onVisible(this.petModel, () => pdata.selPet != "0");
        this.updatePetPrefab();
        evt.on("pdata.selPet", this.updatePetPrefab, this);
        this.onClick(this.node_btn_pet, this.click_pet)
        // 第二关后 ，宠物引导 完后
        this.onVisible(this.node_btn_pet, () => pdata.level > 2)

        // console.log('bgm', csv.Audio.homeBgm);
        Device.playBGM(csv.Audio.homeBgm);
        // evt.on("essential_data", this.render, this);
        evt.on("View.onHidden", this.render, this);
        evt.on("pdata.diamond", this.onGetDiamond, this);
        evt.on("pdata.gold", this.onGetGold, this);
        evt.on("pdata.energy", this.onGetHeart, this);
        evt.on("pdata.playerlv", this.onLvExpChanged, this)
        evt.on("pdata.exp", this.onLvExpChanged, this)

    }

    onLoadFinished(params) {
        if (params) {
            if (params.msg) {
                Toast.make(params.msg)
            }
        }
    }

    onLvExpChanged() {
        let canUp = pdata.upPlayer();
        if (canUp) {
            this.lab_LV.string = pdata.playerlv.toString()
        }
        this.lab_exe.string = (pdata.exp * 100).toFixed() + "%";
    }

    onGetDiamond(n) {
        this.lab_diamond.string = n
    }

    onGetGold(n) {
        this.lab_gold.string = n
    }

    onGetHeart(n) {
        this.lab_engergy.string = n;
    }


    start() {
        this.render();
        // 카카오 가로모드 가이드: 가장자리 버튼을 Safe Area 안쪽·GNB 밖으로 (나란한 버튼은 한 묶음)
        keepInKakaoSafeArea(cc.find('Btn/menu', this.node));
        keepInKakaoSafeArea([cc.find('Btn/btn_breakthrough', this.node), cc.find('Btn/btn_parkour', this.node)]);
        keepInKakaoSafeArea(cc.find('UITop', this.node));
        guider.enterHome();
        // 치트 시스템 초기화
        GameCheats.init();
        if (!guider.isInGuide) {
            if (gUtil.isNextDay(pdata.signInTime)) {
                if (pdata.signIn.date >= 7) {
                    pdata.signIn = { date: 1, isSignIn: false };
                }
                else if (pdata.signIn.isSignIn == true) {
                    pdata.signIn = { date: pdata.signIn.date + 1, isSignIn: false };
                }
                vm.show("UI_signIn");
            }
        }
        evt.emit("Home.start")

        // 카카오 게임로그: FirstPage(게임 접속 후 최초 1회). 비카카오 환경 안전 no-op.
        //   홈 재진입(게임→홈 복귀)·GNB reload 시 start()가 다시 호출되므로 sessionStorage 키로 세션당 1회만 발사.
        //   (sessionStorage 는 탭 단위 — 페이지 reload 에도 유지, 새 탭/세션 진입 시 초기화.)
        try {
            const kakaoSdk = require("../../../framework/Hi5/business/kakaoSdk");
            if (kakaoSdk && kakaoSdk.isKakao && kakaoSdk.isKakao()) {
                const KEY = "kakao_firstpage_logged";
                let alreadyLogged = false;
                try { alreadyLogged = !!(window.sessionStorage && window.sessionStorage.getItem(KEY)); } catch (e) {}
                if (!alreadyLogged) {
                    try { window.sessionStorage && window.sessionStorage.setItem(KEY, "1"); } catch (e) {}
                    kakaoSdk.sendLog("first_page", {});
                }
            }
        } catch (e) { console.warn("[Home] kakao FirstPage 로그 예외:", e); }
    }

    onDestroy() {
        evt.off(this);
    }

    /**
     * 선택된 영웅에 맞는 스파인 데이터 로드 및 적용
     */
    private updateHeroSpine() {
        const heroId = pdata.selHero;
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

            if (this.heroModel && skeletonData) {
                this.heroModel.skeletonData = skeletonData;
                this.heroModel.setAnimation(0, "Idle", true);
            }
        });
    }

    /**
     * 선택된 펫에 맞는 prefab 로드 및 애니메이션 재생
     */
    private updatePetPrefab() {
        if (!this.petModel) return;

        // 기존 자식 노드 제거
        this.petModel.removeAllChildren();

        const petId = pdata.selPet;
        if (petId === "0") return;

        const petData = pdata.selPetData;
        if (!petData || !petData.prefabPath) {
            console.warn(`Pet prefab path not found for pet ID: ${petId}`);
            return;
        }

        cc.loader.loadRes(petData.prefabPath, cc.Prefab, (err, prefab: cc.Prefab) => {
            if (err) {
                console.error(`Failed to load pet prefab: ${petData.prefabPath}`, err);
                return;
            }

            if (this.petModel && prefab) {
                const petNode = cc.instantiate(prefab);
                this.petModel.addChild(petNode);
                petNode.setPosition(0, 0);

                // Follow 컴포넌트 비활성화 (로비에서는 따라다니지 않음)
                const pet = petNode.getComponent('Pet');
                if (pet && pet.follower) {
                    pet.follower.enabled = false;
                }

                // DragonBones 애니메이션 재생
                // 정적 펫: 애니메이션 재생 안함 (기본 포즈 유지)
                // 한 번만 재생 펫: 1회 재생 후 멈춤
                // 나머지 펫: 무한 루프
                const petsStatic = ["2", "7", "10", "11"];  // 미식가, 엔젤하트, 스톰볼, 점핑버드
                const petsPlayOnce = ["1", "3"];  // 파워버섯, 꼬마순무 - 한 번만 재생
                const armature = petNode.getComponent(dragonBones.ArmatureDisplay);
                if (armature) {
                    if (petsPlayOnce.includes(petId)) {
                        armature.playAnimation("run", 1);  // 1회만 재생
                    } else if (!petsStatic.includes(petId)) {
                        armature.playAnimation("run", 0);  // 무한 루프 재생
                    }
                    // 정적 펫은 애니메이션 재생 안함
                }

                // Animation 컴포넌트: 특정 펫들은 비활성화, 나머지는 활성화
                // 비활성화 대상: 파워버섯(1), 미식가(2), 순무(3), 엔젤하트(7), 스톰볼(10), 점핑버드(11)
                const petsWithAnimDisabled = ["1", "2", "3", "7", "10", "11"];
                const anim = petNode.getComponent(cc.Animation);
                if (anim) {
                    if (petsWithAnimDisabled.includes(petId)) {
                        anim.enabled = false;
                    } else {
                        anim.enabled = true;
                        anim.play();
                    }
                }

                
            }
        });
    }

    

    /** 카카오 게임로그: Shop(상점 진입). 비카카오 안전 no-op. */
    private _logShop(shop: string) {
        try {
            const kakaoSdk = require("../../../framework/Hi5/business/kakaoSdk");
            if (kakaoSdk && kakaoSdk.isKakao && kakaoSdk.isKakao()) {
                kakaoSdk.sendLog("shop", { shop: shop });
            }
        } catch (e) { console.warn("[Home] kakao Shop 로그 예외:", e); }
    }

    //获取体力
    private click_get_engergy() {

        this._logShop("heart");
        vm.show("UIRedHeartShop");
    }
    //获取银币
    private click_get_gold() {

        this._logShop("silver");
        vm.show("UISilverCoin");
    }
    //获取钻石
    private click_get_diamond() {

        this._logShop("diamond");
        vm.show("UIDiamondShop");
    }

    //角色
    private click_role() {

        this._logShop("hero");
        vm.show("UIHeroShop");
    }

    //宠物
    private click_pet() {

        this._logShop("pet");
        vm.show("UIPet");
    }

    //排行
    private click_ranking() {
        // 카카오 환경: native showRank 미지원 → 코드 렌더 KakaoRankView 사용.
        // 그 외(hi5games/일반 웹): 기존 UIRank(서버 /api/rank) 경로 유지.
        try {
            const kakaoSdk = require("../../../framework/Hi5/business/kakaoSdk");
            if (kakaoSdk && kakaoSdk.isKakao && kakaoSdk.isKakao()) {
                const KakaoRankView = require("../../../framework/Hi5/KakaoRankView");
                KakaoRankView.open();
                return;
            }
        } catch (e) {
            console.warn("[Home] kakao 랭킹 분기 예외:", e);
        }
        vm.show("UIRank");
    }

    //礼物
    private click_gift() {

        vm.show("UIDrawBox");
    }

    //设置
    private click_setting() {

        vm.show("UISetting");
    }

    //闯关模式
    private click_breakthrough(e) {

        if (pdata.energy <= 0) {
            // Toast.make(LocalizationManager.getText("@notEnoughHeart"));
            // Toast.make("爱心不足");
            vm.show("UIRedHeartShop", () => {
                InventoryUI.instance.setTarget(e.target)
                vm.hide("UIRedHeartShop");
                Loading.show(0.5);
                this.scheduleOnce(() => {
                    vm.show("UILevels");
                }, 0.5)
            })
            return;
        }
        pdata.gameMode = ParkourType.Normal;
        this._logClickStart("normal");
        vm.show("UILevels")
    }

    /** 카카오 게임로그: ClickStart(시작 버튼 → 게임 진입). 비카카오 안전 no-op. */
    private _logClickStart(mode: string) {
        try {
            const kakaoSdk = require("../../../framework/Hi5/business/kakaoSdk");
            if (kakaoSdk && kakaoSdk.isKakao && kakaoSdk.isKakao()) {
                kakaoSdk.sendLog("click_start", { mode: mode });
            }
        } catch (e) { console.warn("[Home] kakao ClickStart 로그 예외:", e); }
    }

    //无尽模式
    private click_parkour(e) {

        if (pdata.playerlv < csv.Config.Unlock_Endless) {
            // Toast.make("达到等级 " + csv.Config.Unlock_Endless + "后解锁！")
            Toast.make(LocalizationManager.getTextWithArgs("@unlockEndlessLevel", csv.Config.Unlock_Endless))
            return
        }
        if (pdata.energy <= 0) {
            // Toast.make(LocalizationManager.getText("@notEnoughHeart"));
            // Toast.make("爱心不足");
            vm.show("UIRedHeartShop", () => {
                InventoryUI.instance.setTarget(e.target)
                vm.hide("UIRedHeartShop");
                Loading.show(0.5);
                this.scheduleOnce(() => {
                    vm.show("UIReady");
                }, 0.5)
            })
            return;
        }
        pdata.gameMode = ParkourType.Infinite;
        this._logClickStart("infinite");
        vm.show("UIReady")
    }

    private test(e) {
        let count = 0;
        let d = ccUtil.get(PlayerData, count + 1);
        let exp = 5000
        let next_require_exp = d.require_exp;
        let isSucc = false;

        console.log("경험치 :", exp, next_require_exp)
        while (exp >= next_require_exp) {
            console.log("경험치1 :", exp, next_require_exp)
            exp = exp - next_require_exp;
            d = ccUtil.get(PlayerData, count + 1);
            next_require_exp = d.require_exp;
            count++
            isSucc = true;
        }
        console.log(isSucc)
        console.log(count)
        console.log(exp)
    }
}
