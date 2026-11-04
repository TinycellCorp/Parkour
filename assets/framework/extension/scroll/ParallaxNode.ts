import ccUtil from "../../utils/ccUtil";
const { ccclass, property, menu } = cc._decorator;

@ccclass
@menu("mimgame/scroll/ParallaxNode")
export default class ParallaxNode extends cc.Component {

    @property
    offset: cc.Vec2 = cc.v2(1, 1);

    @property(cc.Node)
    refrenceNode: cc.Node = null;

    refrecenOffset: cc.Vec2 = cc.Vec2.ZERO;

    size: cc.Size = cc.winSize;

    @property
    horizontal_repeat: boolean = true

    @property
    vertical_repeat: boolean = false

    @property
    inverted: boolean = false;

    dir: number = 1;

    /** 복사본별 원본에서 떨어진 칸 수(0=원본). 반전 배치에 쓴다 */
    private _tileIndex: Map<cc.Node, number> = new Map();
    /** 반전 배치 중이면 스크롤 주기가 2칸(같은 무늬가 2칸마다 반복) */
    private _mirror: boolean = false;

    private applyMirror() {
        this.node.children.forEach(v => {
            const idx = this._tileIndex.get(v) || 0;
            v.scaleX = Math.abs(v.scaleX) * (this._mirror && idx % 2 === 1 ? -1 : 1);
        });
    }

    @property
    padding: number = 0;

    onLoad() {
        this.dir = this.inverted ? -1 : 1;
    }
    //需要在将需要 复制的层放在组件所在节点的子节点下
    // 且该节点只能放在摄像机下 面  作为子节点 
    //camera ->this -> content
    start() {
        this.refrecenOffset = this.refrenceNode.getPosition();
        // 가로가 긴 기기 대응: 배경 복사 개수를 늘림 (5개: -2, -1, 0, 1, 2)
        let child = this.node.children[0]
        this.size = child.getContentSize();
        if (this.horizontal_repeat) {
            // 화면 너비에 맞게 복사본 개수 계산 (최소 5개)
            const screenWidth = cc.winSize.width;
            const copyCount = Math.max(4, Math.ceil(screenWidth / child.width) * 2);
            // +1: 반전 배치(주기 2칸)에서도 화면 끝까지 덮이도록
            const halfCount = Math.floor(copyCount / 2) + 1;

            this._tileIndex.set(child, 0);
            // 칸 간격은 원래 폭, 폭만 padding 만큼 키워 모든 칸이 겹치게 한다
            //   (전엔 원본만 키워 복사본 사이 이음매에 가장자리 반투명 픽셀이 세로줄로 비쳤다)
            const w = child.width;
            child.width += this.padding;
            for (let i = 1; i <= halfCount; i++) {
                let cLeft = cc.instantiate(child);
                let cRight = cc.instantiate(child);
                cLeft.parent = this.node;
                cRight.parent = this.node;
                cLeft.x = -w * i;
                cRight.x = w * i;
                this._tileIndex.set(cLeft, i);
                this._tileIndex.set(cRight, i);
            }
            this.applyMirror(); // start 전에 setBackground 가 먼저 불린 경우
        } else if (this.vertical_repeat) {
            // 세로도 동일하게 확장
            const screenHeight = cc.winSize.height;
            const copyCount = Math.max(4, Math.ceil(screenHeight / child.height) * 2);
            const halfCount = Math.floor(copyCount / 2);

            for (let i = 1; i <= halfCount; i++) {
                let cBottom = cc.instantiate(child);
                let cTop = cc.instantiate(child);
                cBottom.parent = this.node;
                cTop.parent = this.node;
                cBottom.y = -child.height * i;
                cTop.y = child.height * i;
            }
            child.height += this.padding;
        }

    }

    // setBackground(backgroundUrl: string, callback) {
    //     this.node.children.forEach(v => {
    //         // let sp = v.getComponent(cc.Sprite);
    //         callback(v)
    //     });
    // }

    setBackground(backgroundUrl: string) {
        // 쇼타임(보너스맵) 하늘은 이어 붙이는 그림이 아니라 칸 경계가 세로 일자로 보인다(릴레이 #133).
        // 한 칸 걸러 좌우 반전해 경계 양쪽 그림을 맞춘다. 일반 맵 배경은 원래 이어지는 그림이라 그대로.
        this._mirror = /showtime/.test(backgroundUrl || '');
        this.node.children.forEach(v => {
            let sp = v.getComponent(cc.Sprite);
            if (backgroundUrl == '') sp.spriteFrame = null;
            else
                ccUtil.setDisplay(sp, backgroundUrl)
        });
        this.applyMirror();

    }

    update() {
        if (this.horizontal_repeat) {
            this.node.x = this.dir * (this.refrenceNode.x - this.refrecenOffset.x) * this.offset.x;
            this.node.x = this.node.x % (this.size.width * (this._mirror ? 2 : 1))
            // 서브픽셀 위치는 복제본 경계에서 1px seam(검은 세로선)을 만든다 → 정수 픽셀로 스냅.
            //   (SmoothFollow 가 타일맵에 쓰는 것과 동일한 처리)
            this.node.x = Math.round(this.node.x);
        }
        else if (this.vertical_repeat) {
            this.node.y = this.dir * (this.refrenceNode.y - this.refrecenOffset.y) * this.offset.y;
            this.node.y = this.node.y % this.size.height
            this.node.y = Math.round(this.node.y);
        }
        // this.node.y = this.node.y % this.size.height
    }
}