import Device from "../../../framework/core/Device";
import { evt } from "../../../framework/core/event";
import FSM from "../../../framework/core/FSM";
import { Shake } from "../../../framework/extension/action/ShakeAction";
import Buff from "../../../framework/extension/buffs/Buff";
import BuffSystem from "../../../framework/extension/buffs/BuffSystem";
import FxHelpher from "../../../framework/extension/fxplayer/FxHelpher";
import SFireAgent from "../../../framework/extension/shooter/SFireAgent";
import PlayerController, { PlayerState } from "../../../framework/fizzx/components/Common/PlayerController";
import FizzBody, { FizzCollideInterface } from "../../../framework/fizzx/components/FizzBody";
import ccUtil from "../../../framework/utils/ccUtil";
import { LocalizationManager } from "../../../framework/Hi5/Localization/LocalizationManager";
import SkeletonComponent from "../Controller/SkeletonComponent";
import { ParkourType, pdata } from "../data/PlayerInfo";
import { heroSpinePaths, heroInGameScale } from "../common/HeroSpinePaths";
import Falloff from "./behaviors/Falloff";
import PlayerDeadDetector from "./behaviors/player/logic/PlayerDeadDetector";
import Game, { root } from "./Game";
import HeroData from "./model/HeroData";
import WeaponData from "./model/WeaponData";

enum State {
    Normal,
    Scaling,
}

export enum SkillState {
    CD,
    Ready,
}

let { ccclass, property } = cc._decorator
@ccclass
export default class Player extends cc.Component implements FizzCollideInterface {

    controller: PlayerController = null;
    @property(SkeletonComponent)
    skeleton: SkeletonComponent = null;

    gun: SFireAgent = null;

    body: FizzBody = null;

    isSlide = false;

    buffSystem: BuffSystem;

    fsm: FSM = null;

    stronger: boolean = false;

    data: HeroData;


    /**
     * 减少伤害百分比  (%)
     */
    damageReduce: number = 0;

    /**
     * 减少cd时间 （s)
     */
    cdReduce: number = 0;

    xMove: number = 1;

    skill: Buff = null;

    skillFsm: FSM = null;

    skillCDTime: number = 9999;


    onLoad() {
        this.gun = this.getComponentInChildren(SFireAgent)
        this.controller = this.getComponent(PlayerController);


        this.controller.onAnimation.on(this.onAnimation, this)

        this.gun.fireSignal.on(this.onAttack, this);

        this.body = this.getComponent(FizzBody);

        this.addComponent(PlayerDeadDetector);

        this.buffSystem = this.addComponent(BuffSystem);

        this.fsm = this.addComponent(FSM);
        this.fsm.init(this, State);
        this.fsm.enterState(State.Normal);

        this.node.zIndex = 99999;

        this.skillFsm = this.addComponent(FSM);
        this.skillFsm.init(this, SkillState)
        this.skillFsm.enterState(SkillState.CD);


    }


    onDestroy() {
        evt.off(this)
    }

    update_CD() {
        if (this.skillFsm.timeElapsed > this.skillCDTime) {
            this.skillFsm.changeState(SkillState.Ready);
        }
    }


    enter_Ready() {
        evt.emit("Player.enter_Ready")
    }

    useSkill() {
        if (this.skillFsm.isInState(SkillState.CD)) return false;
        Device.playSfx(this.data.skillAudio);
        this.skillFsm.changeState(SkillState.CD);
        this.doSkill();
        return true;
    }


    onEnable() {
        /**首次 技能 cd 固定 为 5 */
        this.scheduleOnce(this.enableSkillFirstTime, 5)
    }

    enableSkillFirstTime() {
        this.skillFsm.changeState(SkillState.Ready)
    }


    onDisable() {

    }

    move() {
        // 사망했으면 이동하지 않음
        if (pdata.hp <= 0) return;
        this.controller.move(this.xMove);
    }


    revive() {
    }

    handleDead() {
        console.log("========== handleDead 호출됨! ==========");
        if (this.data) {
            Device.playSfx(this.data.dieAudio);
        }
        
        // 컨트롤러 중지 (이동 완전히 비활성화)
        this.controller.setMovable(false);
        this.controller.enabled = false; // 컨트롤러 비활성화
        
        // FizzBody를 물리 시스템에서 완전히 제거 (충돌 무시)
        this.body.remove();
        this.body.enabled = false; // FizzBody 컴포넌트 비활성화 (lateUpdate 실행 중지)
        console.log("FizzBody removed and disabled");
        
        // 초기 낙하 속도 설정
        this.body.xv = 0;
        this.body.yv = -100;
        
        this.skeleton.stopMain();
        this.skeleton.play("dead")
        this.buffSystem.stopAll();
        return true;
    }

    getHit() {
        if (pdata.hp <= 0) return;
        this.skeleton.play("Hit");
        Device.vibrate(true);
        Device.playSfx(csv.Audio.sfx_player_hurt);
    }

    normalSize: cc.Size;
    doubleSize: cc.Size;

    set(id) {
        this.data = ccUtil.get(HeroData, id)
        this.switchWeapon(this.data.weapon)
        // set skeleton from template
        //set skill s 
        //开跑

        //set passive skill
        this.setPassiveSkill();
        this.setSkill(id);
        // 히트박스 크기 (일반: 1.25배 확대, 거인화: 원래값)
        this.normalSize = cc.size(75, 138)
        this.doubleSize = cc.size(120, 220)
        this.controller.jumpMax = this.data.jumpMax;

        this.buffSystem.broadcast('ResetHero', this)

        // this.buffSystem.broadcast("changeHero", id)
        // this.setNormalSize()
        return this.setSkeleton(this.data.prefabPath, id);
    }

    /**set skeleton from template */
    /** 영웅별 크기 보정(heroInGameScale). setNormalSize/setDoubleSize 목표 배율에 곱한다 */
    private heroScale: number = 1;

    async setSkeleton(prefabPath, heroId: string) {
        this.heroScale = heroInGameScale[heroId] || 1;
        let res = await ccUtil.getRes(prefabPath, cc.Prefab)
        let node = LocalizationManager.instantiatePrefab(res as unknown as cc.Prefab);
        if (node == null) return;
        this.skeleton.node.destroy()
        this.skeleton = node.getComponentInChildren(SkeletonComponent)
        this.skeleton.node.parent = this.node;
        node.zIndex = -1;
        this.skeleton.onComplete(this.onPlayComplete, this)
        // this.skeleton.setArmature("dead")
        let weaponNode = node.getChildByName("weapon")
        if (weaponNode) {
            this.gun.node.setPosition(weaponNode.getPosition())
        }
        this.node.setContentSize(node.getContentSize())
        this.setNormalSize();
        // 영웅 프리팹 기본 배율(0.327)을 그대로 쓰면 원본이 큰 영웅(라이언·튜브 등)이 커 보인다 → 바로 보정
        this.skeleton.node.scale = 0.327 * this.heroScale;

        // 카카오 스파인 데이터로 교체
        const kakaoSpinePath = heroSpinePaths[heroId];
        if (kakaoSpinePath) {
            cc.loader.loadRes(kakaoSpinePath, sp.SkeletonData, (err, skeletonData: sp.SkeletonData) => {
                if (err) {
                    console.error(`Failed to load kakao spine: ${kakaoSpinePath}`, err);
                    return;
                }
                if (this.skeleton && this.skeleton.skeleton && skeletonData) {
                    const sk = this.skeleton.skeleton;
                    // 비동기 스왑 시점에 이미 재생 중인 애니메이션(주로 Run)을 보존한다.
                    // 무조건 "Idle"로 덮으면, 게임 시작 후 달리기가 시작된 뒤 이 콜백이
                    // 늦게 도착할 때 Idle로 멈춰버린다(Idle엔 player_walk 이벤트가 없어 영구 정지).
                    let resumeAnim = "Idle";
                    let resumeLoop = true;
                    const cur = (typeof sk.getCurrent === "function") ? sk.getCurrent(0) : null;
                    if (cur && cur.animation && cur.animation.name) {
                        resumeAnim = cur.animation.name;
                        resumeLoop = cur.loop;
                    }
                    sk.skeletonData = skeletonData;
                    try {
                        sk.setAnimation(0, resumeAnim, resumeLoop);
                    } catch (e) {
                        sk.setAnimation(0, "Idle", true);
                    }
                    // (구) 여기서 scale 을 1.0/0.8 로 덮었는데, 로딩이 늦어 축소 연출(0.5초)이 끝난 뒤 도착하면
                    // 캐릭터가 약 3배로 남았다. 크기는 setNormalSize/setDoubleSize 가 정하므로 현재 목표로 맞춘다.
                    if (!this.fsm.isInState(State.Scaling)) {
                        this.skeleton.node.scale = (this.stronger ? 0.65 : 0.327) * this.heroScale;
                    }
                }
            });
        }
    }

    setPassiveSkill() {
        //开局 被动技能
        this.buffSystem.startBuff(this.data.passiveSkill.name);
    }

    setSkill(id) {
        this.skill = this.buffSystem.getBuff(this.data.skill)
        let lv = pdata.getHeroLevel(id);
        if (lv >= 1) {
            this.skillCDTime = this.data.lvs[lv - 1].data;
        } else {
            // -- 未拥有的英雄 ，技能CD  为1级 CD
            this.skillCDTime = this.data.lvs[0].data;
            // evt.emit("Player.setControllerEnable", "fire", false);
            // this.skillFsm.changeState(SkillState.CD);
            // this.skillCDTime = 9999;
        }
    }


    start() {

    }

    //使用技能
    doSkill() {
        if (this.data) {
            //param 续时间 
            this.buffSystem.startBuff(this.data.skill.name, this.data.skill.param[0] || 1);
        }
    }

    slide() {
        if (pdata.hp <= 0) return
        if (this.controller.is(PlayerState.Run) || this.controller.is(PlayerState.Idle)) {
            this.skeleton.play("Slide")
        }
        // 슬라이드 시 히트박스: 원래 값 고정 (60 x 55)
        // setShape(width, height, anchorX, anchorY) 형식
        if (this.stronger) {
            this.body.setShape(this.doubleSize.width, this.doubleSize.height / 2, 0.5, 0);
        } else {
            this.body.setShape(60, 55, 0.5, 0);
        }
        this.isSlide = true;
    }

    endSlide() {
        if (pdata.hp <= 0) return
        this.isSlide = false;
        this.runOrRush()
        // 거인 상태면 doubleSize 기준, 아니면 normalSize 기준
        if (this.stronger) {
            this.body.setShape(this.doubleSize.width, this.doubleSize.height, 0.5, 0);
        } else {
            this.body.setShape(this.normalSize.width, this.normalSize.height, 0.5, 0);
        }
    }

    runOrRush() {
        this.skeleton.play("Run", 0)
        let is_rush = this.buffSystem.isEnabled("rush")
        return;
        if (is_rush) {
            this.skeleton.play("rush", 0)
        } else {
            this.skeleton.play("run", 0)
        }
    }


    attackState: sp.spine.TrackEntry;

    onAnimation(name) {
        this.onPlayAudioFx(name);
        // if not dead 
        if (pdata.hp <= 0) return;
        this.attackState = null;
        // console.log(name);
        let pos = this.node.getPosition();
        if (name == 'player_walk') {
            this.runOrRush()
        } else if (name == 'player_idle') {
            // this.skeleton.play("idle", 0)
            this.runOrRush()
        }
        else if (name == 'player_jump') {
            // console.log(this.playerController.jumpCount);
            if (this.controller.jumpCount >= 2) {
                this.skeleton.play("Jump2", 2)
            } else {
                this.skeleton.play("Jump", 1)
                pos.y -= this.node.height / 2;
                Game.instance.play_efx("jump_dust", pos, 0, this.controller.dir, 1)
            }
        } else if (name == 'player_land') {
            pos.y -= this.node.height / 2;
            Game.instance.play_efx("land_dust", pos)
            this.shake();
        }
        else if (name == 'player_fall') {
            // this.skeleton.play("down", 0)
        } else if (name == 'player_attack') {
            // this.skeleton.setUpperBody("attack", 1, 0)
            this.attackState = this.skeleton.play("attack", 1)
            // attack 
        }
    }

    onPlayAudioFx(name) {
        let url = "";
        url = csv.Audio["sfx_" + name];
        if (!url) return;
        Device.playSfx(url);
    }

    onPlayComplete(e) {
        if (pdata.hp <= 0) return
        if (e.animation && e.animation.name == 'attack') {
            this.runOrRush()
        }
    }

    onAttack(bullets) {

    }

    setNormalSize() {
        let avatar = this.skeleton.node;
        avatar.y = - 60;
        this.body.setShape(this.normalSize.width, this.normalSize.height, 0.5, 0)
        // 이미 Scaling 중이면 changeState 가 무시돼 이전 목표 배율이 남는다(setDoubleSize 와 같은 처리)
        if (this.fsm.isInState(State.Scaling)) {
            let state = this.fsm.getState(State.Scaling)
            //@ts-ignore
            state._scale = 0.327 * this.heroScale
        } else {
            this.fsm.changeState(State.Scaling, 0.327 * this.heroScale);
        }
        this.stronger = false;
        this.unschedule(this.shake)
    }

    setDoubleSize() {
        this.stronger = true;
        let avatar = this.skeleton.node;
        avatar.y = - 120;
        this.body.setShape(this.doubleSize.width, this.doubleSize.height, 0.5, 0)
        if (this.fsm.isInState(State.Scaling)) {
            let state = this.fsm.getState(State.Scaling)
            //@ts-ignore
            state._scale = 0.65 * this.heroScale
        } else {
            this.fsm.changeState(State.Scaling,  0.65 * this.heroScale)
        }
        this.schedule(this.shake, 0.5)
    }


    shake() {
        if (this.body.isStanding && this.stronger) {

            let node = cc.Camera.main.node
            node.runAction(Shake.create(0.1, 0, 5))
        }
    }

    //---------------------------[state]-----------------------------
    enter_Scaling(state, scale) {
        state._scale = scale;
    }

    update_Scaling(state) {
        let avatar = this.skeleton.node;
        avatar.scale = cc.misc.lerp(avatar.scale, state._scale, 0.1)
        if (this.fsm.timeElapsed > 0.5) {
            this.fsm.changeState(State.Normal)
        }
    }

    //---------------------------[state_end]-----------------------------

    switchWeapon(weaponName) {
        //switch wepaon 
        let weaponData = ccUtil.get(WeaponData, weaponName)
        this.gun.data = weaponData;
        this.gun.initSpeed = weaponData.speed;
        this.gun.bulletDamage = weaponData.damage;
        //preload skill res 
        cc.loader.loadRes(weaponData.castFx, cc.Prefab)
        FxHelpher.preload(weaponData.hit)

        if (weaponData.bullet) {
            ccUtil.getRes("weapons/bullets/" + weaponData.bullet, cc.Prefab).then(v => {
                this.gun.bulletPrefab = v as unknown as cc.Prefab;
            })
        }
    }

    onFizzCollideEnter(b: FizzBody, nx: number, ny: number, pen: number) {
        let node = b.node;
        let name = 'road';
        if (node) {
            name = b.node.name
            // let pos = b.node.getPosition();

        } else {
            if (nx == -1 || nx == 1) {
                //飞檐走
                this.controller.jumpCount = 0;
            }
        }
        // console.log("hit " + name, nx, ny, pen)
    }
    onFizzCollideExit?(b: FizzBody, nx: number, ny: number, pen: number) {

    }
    onFizzCollideStay?(b: FizzBody, nx: number, ny: number, pen: number) {
    }
}