import PoolManager from "../../../framework/core/PoolManager";
import gUtil from "../../../framework/core/gUtil";
import FxHelpher, { FxData } from "../../../framework/extension/fxplayer/FxHelpher";
import FxLayer from "../../../framework/extension/fxplayer/FxLayer";
import PoolSpawner from "../../../framework/extension/optimization/PoolSpawner";
import ParallaxNode from "../../../framework/extension/scroll/ParallaxNode";
import MapLoader from "../../../framework/extension/tilemap/MapLoader";
import FizzBody from "../../../framework/fizzx/components/FizzBody";
import FizzHelper, { BodyProperties } from "../../../framework/fizzx/components/FizzHelper";
import mvcView from "../../../framework/ui/mvcView";
import ccCache from "../../../framework/utils/ccCache";
import ccUtil from "../../../framework/utils/ccUtil";
import LoadingScene from "../common/LoadingScene";
import UIPlayControls from "./UIPlayControls";
import { ParkourType, pdata } from "../data/PlayerInfo";
import SortedCursorLayer from "./extension/SortedCursorLayer";
import ItemData, { BuffData } from "./model/ItemData";
import LevelData from "./model/LevelData";
import MapSegData from "./model/MapSegData";
import PetData from "./model/PetData";
import ObjectFactory from "./ObjectFactory";
import Item from "./objects/Item";
import Pet from "./objects/Pet";
import Player, { SkillState } from "./Player";
import TmxLayerWalker, { ITileObjectFactory, TileAttrs } from "../../../framework/extension/tilemap/TmxLayerWalker";
import LevelMode from "./behaviors/LevelMode";
import InfiniteMode from "./behaviors/InfiniteMode";
import InfiniteLevelData from "./model/InfiniteLevelData";
import BuffSystem from "../../../framework/extension/buffs/BuffSystem";
import FSM from "../../../framework/core/FSM";
import FizzManager from "../../../framework/fizzx/components/FizzManager";
import InventoryUI from "../view/TopMostInventoryUI";
import Device from "../../../framework/core/Device";
import { evt } from "../../../framework/core/event";
import NoobLevel from "./behaviors/NoobLevel";
import GameLayerTop from "./views/GameLayerTop";
import { LocalizationManager } from "../../../framework/Hi5/Localization/LocalizationManager";
import Hi5 from "../../../framework/Hi5/Hi5";
import { keepInKakaoSafeArea } from "../../../framework/Hi5/KakaoSafeUI";

// Hi5 플랫폼 여부 확인
const isHi5Platform = () => {
    return Hi5 != null;
};

let { ccclass, property } = cc._decorator
export let root: Game = null;

enum State {
    Run,
    Pause,
    Resume,
    End,
    Stop
}

@ccclass
export default class Game extends mvcView implements ITileObjectFactory {

    @property(MapLoader)
    mapLoader: MapLoader = null;

    static instance: Game = null;

    playControls: UIPlayControls = null;

    @property(ParallaxNode)
    bgLayer1: ParallaxNode = null

    @property(ParallaxNode)
    bgLayer2: ParallaxNode = null

    itemLayer: SortedCursorLayer = null;
    obstacleLayer: SortedCursorLayer = null;

    private obstacleMaskWrapper: cc.Node = null;

    player: Player = null;

    pet: Pet = null;

    fsm: FSM = null;

    @property(cc.Node)
    mapNode: cc.Node = null;


    @property(cc.Node)
    loadingbg: cc.Node = null;

    @property(cc.Node)
    subEnergyTag: cc.Node = null;

    @property(cc.ProgressBar)
    loadingBar: cc.ProgressBar;

    @property(GameLayerTop)
    uilayer: GameLayerTop;

    @property(cc.Node)
    transitionNode: cc.Node = null;

    isFirst: boolean = true;

    _invisibleRectsEnabled = false;
    onLoad() {
        Game.instance = this;
        root = this;
        // 인게임 해상도 정책: 디자인보다 가로로 넓으면 높이고정(가로 채움), 좁으면 너비고정(세로 채움).
        //   Canvas 기본값 fitWidth+fitHeight=SHOW_ALL 은 와이드에서 좌우 검은 레터박스를 만든다 → 회피.
        //   loadMap/카메라 추적(start)보다 먼저 적용해 winSize 가 올바른 값으로 잡히게 한다.
        this._applyAdaptiveResolution();
        cc.director.on('resolution:changed', this._applyAdaptiveResolution, this);
        this.playControls = this.getComponentInChildren(UIPlayControls);
        this.player = this.getComponentInChildren(Player);

        if (CC_DEBUG) {
            window['maploader'] = this.mapLoader;
            window['game'] = this;
        }

        csv.Item.values.filter(v => v.anim != null).forEach(v => {
            ccCache.loadFrameAnimClip(ccUtil.get(ItemData, v.id).anim)
        })
        if (!Device.getBgmState(csv.Audio.gameBgm)) {
            Device.playBGM(csv.Audio.gameBgm);
        }
        this.fsm = this.addComponent(FSM);
        this.fsm.init(this, State);

        // 장애물 레이어 클리핑은 loadMap()에서 obstacleLayer 생성 후 호출됨
        // this.setupObstacleLayerClipping();
    }

    /** 화면비에 따라 Canvas 정책을 FIXED_HEIGHT(가로 넓음)/FIXED_WIDTH(세로 넓음)로 적응 → 레터박스 제거. */
    private _applyAdaptiveResolution() {
        const canvas = cc.Canvas.instance;
        if (!canvas) return;
        const design = canvas.designResolution;
        const designRatio = design.width / design.height;
        const frame = cc.view.getFrameSize();
        const screenRatio = frame.width / frame.height;
        if (screenRatio >= designRatio) {
            // 가로로 넓음 → 높이 고정, 가로 확장(좌우 더 보임, 검은띠 없음)
            canvas.fitHeight = true;
            canvas.fitWidth = false;
        } else {
            // 세로로 김 → 너비 고정, 세로 확장
            canvas.fitWidth = true;
            canvas.fitHeight = false;
        }
    }

    /**
     * 장애물 레이어 클리핑 설정
     * 장애물만 화면 바깥에서 보이지 않도록 Mask로 클리핑
     * 배경과 다른 요소들은 영향받지 않음
     *
     * 주의: cc.Mask는 스텐실 버퍼를 사용하여 약간의 성능 오버헤드가 있음
     */
    private setupObstacleLayerClipping() {
        // obstacleLayer가 아직 생성되지 않은 경우
        if (!this.obstacleLayer || !this.obstacleLayer.node) {
            console.warn("[Game] obstacleLayer not ready for clipping");
            return;
        }

        const obstacleNode = this.obstacleLayer.node;

        // 이미 적용된 경우 중복 적용 방지
        if (obstacleNode.parent && obstacleNode.parent.name === "obstacleMask") {
            console.log("[Game] Obstacle layer clipping already enabled");
            return;
        }

        // 동적으로 해상도 판단: 실제 화면 크기 또는 디자인 해상도 사용
        const canvas = cc.Canvas.instance;
        const designSize = canvas ? canvas.designResolution : cc.size(1136, 640);
        const visibleSize = cc.view.getVisibleSize();

        // 더 큰 값을 사용하여 클리핑 영역이 화면을 벗어나지 않도록 함
        const clipWidth = Math.max(designSize.width, visibleSize.width) * 2; // 맵이 이동하므로 넓게
        const clipHeight = Math.max(designSize.height, visibleSize.height);

        // Mask 래퍼 노드 생성
        const maskWrapper = new cc.Node("obstacleMask");
        maskWrapper.setContentSize(clipWidth, clipHeight);
        maskWrapper.setAnchorPoint(0.5, 0.5);
        maskWrapper.setPosition(0, 0);

        console.log(`[Game] Obstacle mask size: ${clipWidth}x${clipHeight}`);

        // Mask 컴포넌트 추가 (RECT 타입으로 사각형 클리핑)
        const mask = maskWrapper.addComponent(cc.Mask);
        mask.type = cc.Mask.Type.RECT;

        // obstacleNode의 부모와 sibling index 저장
        const originalParent = obstacleNode.parent;
        const siblingIndex = obstacleNode.getSiblingIndex();

        // maskWrapper를 원래 부모에 삽입
        maskWrapper.parent = originalParent;
        maskWrapper.setSiblingIndex(siblingIndex);

        // obstacleNode를 maskWrapper의 자식으로 이동
        obstacleNode.parent = maskWrapper;

        // 매 프레임 위치 업데이트를 위해 참조 저장
        this.obstacleMaskWrapper = maskWrapper;

        console.log("[Game] Obstacle layer clipping enabled - obstacles will be clipped at screen boundaries");
    }


    onDestroy() {
        cc.director.off('resolution:changed', this._applyAdaptiveResolution, this);
        root = null;
        //保存
        pdata.save("diamond")
    }

    //change play
    // changePlayer(node: cc.Node) {
    //     this.mapLoader.playerNode = node;
    //     this.playControls.playerController = node.getComponent(PlayerController);
    // }


    restart() {
        LoadingScene.goto("Main")
    }

    go() {
        this.player.buffSystem.startBuff("loseLife")
        this.fsm.changeState(State.Run)

        // Hi5 게임 시작 알림
        if (isHi5Platform()) {
            Hi5.GameStart();
            console.log("[Hi5] GameStart called");
        }

        // 카카오 게임로그: StartPlay(플레이 시작, 판당 1회). gameStart()로 play_time 추적 시작.
        //   go()는 onLevelLoadCompleted(맵 로드 완료) 에서 판당 1회만 호출 — 부활(revive)은 update_Resume 경로라 미포함.
        try {
            const kakaoSdk = require("../../../framework/Hi5/business/kakaoSdk");
            if (kakaoSdk && kakaoSdk.isKakao && kakaoSdk.isKakao()) {
                kakaoSdk.gameStart({ mode: pdata.gameMode == ParkourType.Infinite ? "infinite" : "normal" });
            }
        } catch (e) { console.warn("[Game] kakao StartPlay 로그 예외:", e); }
    }

    start() {
        pdata.enterGame();
        // 카카오 가로모드 가이드: 좌우 하단 조작 버튼을 Safe Area 안쪽으로 (점프·스킬은 오른쪽 한 묶음)
        keepInKakaoSafeArea(cc.find('Canvas/uilayer/operation/slide_btn'));
        keepInKakaoSafeArea([cc.find('Canvas/uilayer/operation/jump_btn'), cc.find('Canvas/uilayer/operation/btn_skill')]);

        this.loadMap();
    }
    // adjustTransitionGradient() 제거:
    //   transition_gradient(전환 와이프용 우측 10px 스트립)는 Widget(alignRight, right=0)으로
    //   이미 실제 화면 우측 끝에 정렬된다(uilayer 가 전체화면 stretch). 기존 함수는 right 를 양수로
    //   덮어써 디자인 1136 경계(=와이드에서 화면 중앙)로 밀어 검은 세로선처럼 보이게 했음 → 제거.

    onLoadFinished(params?) {
        if (params) {
            if (params.type) {
                if (params.type == "subEnergy") {
                    this.subEnergy();
                }
            }
        }
    }

    subEnergy() {
        InventoryUI.instance.setTarget(this.subEnergyTag);
        this.scheduleOnce(() => {
            pdata.energy--;
            pdata.save("energy");
        }, 0.1)
    }
    /** 飞行状态时开启，防止掉下去  */
    private invisibleRectBodies = [];

    loadMap() {
        // preload prefabs
        let spawnerPool = PoolSpawner.get("monsters")
        //todo 跟据关卡需要的情况加载 
        spawnerPool.preload("action_001", "objects/prefabs/action_001")
        spawnerPool.preload("action_002", "objects/prefabs/action_002")
        spawnerPool.preload("action_003", "objects/prefabs/action_003")
        spawnerPool.preload("action_004", "objects/prefabs/action_004")
        spawnerPool.preload("action_005", "objects/prefabs/action_005")
        spawnerPool.preload("action_006", "objects/prefabs/action_006")
        spawnerPool.preload("action_007", "objects/prefabs/action_007")
        spawnerPool.preload("action_008", "objects/prefabs/action_008")
        spawnerPool.preload("action_009", "objects/prefabs/action_009")
        spawnerPool.preload("action_010", "objects/prefabs/action_010")
        spawnerPool.preload("action_011", "objects/prefabs/action_011")
        spawnerPool.preload("action_012", "objects/prefabs/action_012")
        spawnerPool.preload("action_013", "objects/prefabs/action_013")
        spawnerPool.preload("action_014", "objects/prefabs/action_014")
        spawnerPool.preload("action_015", "objects/prefabs/action_015")

        let node = new cc.Node("itemLayer");
        node.parent = this.mapNode
        node.zIndex = 11;
        this.itemLayer = node.addComponent(SortedCursorLayer)
        // this.itemLayer.func_isInValid = (node: cc.Node) => node.x < (-this.mapLoader.tiledmap.node.x - cc.winSize.width / 2)

        node = new cc.Node("obstalceLayer");
        node.parent = this.mapNode;
        node.zIndex = 10;
        this.obstacleLayer = node.addComponent(SortedCursorLayer)
        // this.obstacleLayer.func_isInValid = this.itemLayer.func_isInValid

        // 장애물 레이어 클리핑 비활성화 - 마스크 문제로 인해 임시 비활성화
        // this.setupObstacleLayerClipping();

        FxLayer.get("map").node.zIndex = 12;

        //fix when playinglv == 0
        pdata.playinglv = pdata.playinglv || 0;

        //模式第一段
        let mapSegData;
        if (pdata.gameMode == ParkourType.Normal) {
            //关卡 — LevelData[playinglv] 가 없으면 1레벨로 폴백, 그래도 없으면 진입 중단(크래시 방지).
            let lvdata = ccUtil.get(LevelData, pdata.playinglv)
            if (!lvdata) {
                cc.warn("[Game] LevelData 없음 playinglv=" + pdata.playinglv + " → lv1 폴백");
                pdata.playinglv = 1;
                lvdata = ccUtil.get(LevelData, pdata.playinglv);
            }
            if (!lvdata || !lvdata.segments || !lvdata.segments[0]) {
                cc.error("[Game] LevelData/segments 로드 실패 — 맵 로드 중단. playinglv=" + pdata.playinglv);
                return;
            }
            mapSegData = lvdata.segments[0];
        } else {
            //无尽
            mapSegData = ccUtil.get(MapSegData, 'forest')
        }
        if (!mapSegData || !mapSegData.level_tmx) {
            cc.error("[Game] mapSegData/level_tmx 없음 — 맵 로드 중단. mode=" + pdata.gameMode + " playinglv=" + pdata.playinglv);
            return;
        }
        this.mapLoader.followOffset = cc.v2(cc.winSize.width / 4, 0);
        this.mapLoader.playerNode.active = false;
        this.mapLoader.loadMap(mapSegData.level_tmx, this.onLoadingMap.bind(this)).then(layerWalker => {
            this.createCollisionLayer(layerWalker);
            this.loadElements(layerWalker)

            // map bg
            this.bgLayer1.setBackground(mapSegData.mapbg[0])
            this.bgLayer2.setBackground(mapSegData.mapbg[1])

            this.player.set(pdata.selHero).then(v => this.setStartBuff())
            this.mapLoader.playerNode.active = true;
            //加载宠物 
            this.equipPet(pdata.selPet);

            //正常关卡
            //添加剩余段
            if (pdata.gameMode == ParkourType.Normal) {
                let levelMode = this.mapNode.getComponent(LevelMode);
                if (!levelMode) {
                    levelMode = this.mapNode.addComponent(LevelMode);
                }
                levelMode.onLoaded.on(this.onLevelLoadCompleted, this)
                if (pdata.playinglv == 0) {
                    //新手关
                    let noobLevel = this.uilayer.getComponent(NoobLevel);
                    if (!noobLevel) {
                        noobLevel = this.uilayer.addComponent(NoobLevel);
                    }
                }
            }
            else {
                let infiniteMode = this.mapNode.getComponent(InfiniteMode);
                if (!infiniteMode) {
                    infiniteMode = this.mapNode.addComponent(InfiniteMode);
                }
                this.onLevelLoadCompleted();
            }

        }).catch(e => console.error("[Game] 맵 로드 실패:", e));
    }

    onLoadingMap(c, t, item) {
        let p = c / t;
        this.loadingBar.progress = p;
    }

    //全部加载结束 
    onLevelLoadCompleted() {
        this.go()
        this.loadingbg.active = false;
        FxHelpher.play("screen", "ui/game_start_tip", cc.Vec2.ZERO)
    }

    setStartBuff() {
        if (pdata.gameMode == ParkourType.Infinite) {
            let buffs = pdata.getStartBuff();
            for (let key in buffs) {
                this.player.buffSystem.startBuff(buffs[key], csv.BuyProps.get(key).buff);
            }
        }
    }

    pauseFizz() {
        FizzManager.instance.enabled = false;
    }
    //---------------------------[state begin]-----------------------------
    enter_Pause() {
        this.player && this.player.buffSystem.pause();
        this.pet && this.pet.buffSystem.pause();
        // 물리 엔진 즉시 정지 (2초 딜레이 제거)
        // 날아오는 몬스터와 플레이어가 일시정지 시 바로 멈추도록
        this.pauseFizz();
    }

    enter_Resume(state, p) {
        state.resumeEvent = p
    }

    update_Resume(state) {
        if (this.fsm.timeElapsed > 3) {
            this.fsm.changeState(State.Run)
            FizzManager.instance.enabled = true;
            if (state.resumeEvent.cmd == "revive") {
                this.revive(state.resumeEvent.heroId);
            }
            vm.hide("UIResume")
            this.player && this.player.buffSystem.resume();
            this.pet && this.pet.buffSystem.resume();
        }
    }


    update_Run() {
        this.run();

        // 장애물 마스크를 화면 중앙에 고정 (맵 이동과 반대로 이동)
        if (this.obstacleMaskWrapper) {
            this.obstacleMaskWrapper.x = -this.mapNode.x;
        }

        this.mapLoader.loadedTmxs.forEach((v, i) => {
            let px = v.node.x + v.node.width
            let ss = -this.mapNode.x - cc.winSize.width / 2;
            if (px < ss) {
                v.node.destroy();
                this.mapLoader.loadedTmxs.splice(i, 1);
            }
        })
    }

    enter_Stop(state, p) {
        this.player.xMove = 1;
        cc.tween(this.player).to(p, { xMove: 0 }).start();
    }

    update_Stop() {
        this.run()
        this.player.body.xv *= 0.99;
    }

    exit_Stop(state, p) {
        this.player.xMove = 1;
    }

    //---------------------------[state end]-----------------------------

    stop(n) {
        this.fsm.changeState(State.Stop, n)
    }

    isPause() {
        return this.fsm.isInState(State.Pause);
    }

    pause() {
        this.fsm.changeState(State.Pause)
    }


    resume(p?, hero?) {
        // BuffSystem.resumeAll();

        // vm.show("UIResume", this.subEnergy.bind(this));
        vm.show("UIResume");
        this.fsm.changeState(State.Resume, { cmd: p, heroId: hero });
    }

    revive(heroId) {
        pdata.isGameEnd = false;
        this.player.buffSystem.startBuff("loseLife")
        this.player.buffSystem.startBuff("revive", 2);
        this.player.set(heroId);
        // PlayerAction: 부활(광고 보상 후 이어하기). revive() 는 부활 실행 단일 지점.
        pdata.logPlayerAction("revive", { hero_id: heroId });
    }


    async appendSegments(segs: MapSegData[], startIndex = 0, endIndex = 0) {
        endIndex = endIndex || segs.length;
        for (let i = startIndex; i < endIndex; i++) {
            await this.mapLoader.appendMap(segs[i].level_tmx, this.onLoadingMap.bind(this)).then(v => {
                this.onSegLoaded(v);
                console.log("load mapseg:" + segs[i].level_tmx)
            }).catch(e => console.error(e))
        }
    }

    onSegLoaded(layerWalker) {
        this.createCollisionLayer(layerWalker, layerWalker.node.x);
        this.loadElements(layerWalker)
        return Promise.resolve();
    }

    loadElements(layerWalker: TmxLayerWalker) {
        layerWalker.setFactory(this);
        //load items
        layerWalker.createGroupObjects("object_item");
        // load obj
        layerWalker.createGroupObjects("object_obstacle")
        // load monster(with animation)
        layerWalker.createGroupObjects("object_monster")
    }

    createCollisionLayer(layerWalker: TmxLayerWalker, offsetX = 0) {
        let krects = layerWalker.findRects("platform", {
            fieldAsSameRegion: 'platform',
        })
        for (let k in krects) {
            let rects = krects[k]
            let p = layerWalker.tiledmap.getPropertiesForGID(parseInt(k))
            let option = {} as BodyProperties
            if (p.platform == 2 || p.platform == 3) {
                option.oneWay = true;
                if (p.platform == 2) {
                    option.paddingTop = 23
                } else {
                    option.paddingTop = 18
                }
            } else {
                option.paddingTop = 23
            }
            rects.forEach(rect => {
                rect.x += offsetX;
                let body = FizzHelper.createRectBody(rect, option)
                if (p.platform == 2) {
                    this.invisibleRectBodies.push(body);
                    body.enabled = this._invisibleRectsEnabled;
                }
            });
        }

    }

    set invisibleRectsEnabled(val) {
        this._invisibleRectsEnabled = val;
        this.invisibleRectBodies.forEach(v => v.enabled = val)
    }


    run() {
        if (this.player)
            this.player.move();
    }


    activateBuff(buff: BuffData) {
        let dur = buff.duration;
        if (this.pet) {
            // 特殊buff  ，添加道具持续时间
            if (this.pet.buffSystem.isEnabled("itemStrength")) {
                dur += this.pet.data.lvs[pdata.selPetLevel - 1].data;
            }
        }
        // 버프 활성화 시 현재 인덱스를 캡처하여 전달
        // (onEnable이 다음 프레임에 호출되어 인덱스가 변경되는 문제 방지)
        // gold 버프는 obstacleLayer, 나머지는 itemLayer 사용
        let startIndex = buff.name === 'gold'
            ? root.obstacleLayer.startIndex
            : root.itemLayer.startIndex;
        let buffData = { startIndex };

        // 디버그 로그
        console.log(`[Game.activateBuff] 버프 활성화:
  - buff.name: ${buff.name}
  - duration: ${dur}
  - buffData.startIndex: ${buffData.startIndex}
  - layer: ${buff.name === 'gold' ? 'obstacleLayer' : 'itemLayer'}`);

        if (this.pet && buff.name == 'magnet') {
            this.pet.buffSystem.startBuff(buff.name, dur, buffData)
        } else {
            root.player.buffSystem.startBuff(buff.name, dur, buffData)
        }
    }


    //装备宠物
    async equipPet(petId) {
        let petData = ccUtil.get(PetData, petId)
        if (petData == null) return;
        if (!petData.prefabPath || petData.prefabPath === "") {
            console.warn(`[Game.equipPet] Invalid prefabPath for petId: ${petId}`);
            return;
        }
        let prefab = await ccUtil.getRes(petData.prefabPath, cc.Prefab)
        let node = LocalizationManager.instantiatePrefab(prefab as unknown as cc.Prefab);
        node.parent = this.mapNode;
        this.pet = node.getComponent(Pet);
        this.pet.set(petId)
        
        // 펫 초기 위치 설정 (플레이어 위치 + 펫 오프셋)
        // 처음 장착 시 이상한 위치로 가는 버그 방지
        const playerPos = this.player.node.getPosition();
        const offset = this.pet.follower.offset;
        node.setPosition(playerPos.x + offset.x, playerPos.y + offset.y);
        
        this.pet.follower.target = this.player.node;
    }

    public async createBodyNode(prefabPath: string, x, y) {
        let prefab = await ccUtil.getRes(prefabPath, cc.Prefab);
        let node = LocalizationManager.instantiatePrefab(prefab as unknown as cc.Prefab);
        if (node == null) return;
        node.parent = this.mapNode;
        node.setPosition(x, y);
        let body = node.getComponent(FizzBody)
        body.syncPosition();
    }

    makeItem(prefab: string, itemName: string, px, py) {
        let layer = this.itemLayer;
        let node = PoolManager.get("items").get(prefab)
        let body = node.getComponent(FizzBody);
        let item = gUtil.getOrAddComponent(node, Item);
        item.changeItem(itemName);
        layer.push(node);
        node.parent = layer.node;
        body.setPosition(px, py)
        return item;
    }

    addToLayer(node: cc.Node, layer: SortedCursorLayer) {
        ccUtil.changeParent(node, layer.node)
        layer.push(node);
    }

    addBodyToLayer(node: cc.Node, layer: SortedCursorLayer) {
        let body = node.getComponent(FizzBody);
        node.setAnchorPoint(cc.v2(0.5, 0.5))
        let px = body.x, py = body.y;
        node.parent = layer.node;
        layer.push(node);
        node.x = px, node.y = py;
        body.syncPosition();
    }

    createGroupObject(node: any, properties, layerName: string, tiledmap: cc.TiledMap) {
        return ObjectFactory.create(tiledmap, layerName, properties, node);
    }


    createObject(objectLayer: cc.TiledLayer, attrs: TileAttrs) {
        //     let type = attrs.properties.type
        //     let path = 'objects/prefabs/' + type;
        //     ccUtil.getRes(path, cc.Prefab).then(prefab => {
        //         let node = cc.instantiate(prefab) as cc.Node;
        //         node.setPosition(attrs.pos);
        //         node.parent = objectLayer.node
        //     })
        //     // console.log(node);
    }

    //--------------
    play_efx(name, pos: cc.Vec2, rotation = 0, scaleX = 1, scaleY = 1) {
        let path = 'effects/prefabs/' + name
        FxLayer.get("map").play(path, { pos, rotation, scaleX, scaleY })
    }

    //-----------------

    transition(callback) {
        cc.tween(this.transitionNode).to(0.5, {
            width: 2500,
        }).delay(0.1).to(0.2, {
            width: 1,
        }).call(callback).start()

    }


}