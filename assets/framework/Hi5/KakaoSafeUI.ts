/**
 * 카카오 가로모드 디자인가이드(0929) — 화면 가장자리 UI 를 Safe Area 안쪽 + 카카오 GNB(⌄ ··· ✕) 밖으로. (CC 2.4)
 *
 * 게임 화면은 끝까지 그리고(배경), 누를 수 있는 UI 만 SDK 가 알려주는 영역을 피해 민다.
 *   - 좌우 Safe Area(노치·카메라): SDK getSafeArea().left/right
 *   - GNB 버튼 영역: SDK getNavRect()
 * 둘 다 CSS px → 엔진 디자인 좌표로 환산(visibleWidth / innerWidth).
 *
 * 사용: keepInKakaoSafeArea(node) 또는 keepInKakaoSafeArea([a, b]) — 배열은 한 묶음으로 같은 거리만큼 민다.
 * 노드가 켜질 때·크기가 바뀔 때·회전·GNB 주입 후 자동 재계산, 노드 파괴 시 자동 해제.
 * 비카카오·세로에서는 SDK 값이 0/null 이라 아무 것도 바꾸지 않는다.
 * 값은 kakaoSdk.js 래퍼(KakaoAdapter 직접 보유) 경유로 지연 require.
 */
const MARGIN = 8; // CSS px — Safe Area·GNB 와 UI 사이 최소 간격

interface Item {
    node: cc.Node;
    widget: cc.Widget | null;
    base: { left: number; right: number; top: number; bottom: number; hc: number; x: number; y: number };
}
interface Entry { items: Item[] }

const entries: Entry[] = [];
let hooked = false;
let sdk: any = null;

function getSdk(): any {
    if (sdk) return sdk;
    // 이 프로젝트는 KakaoAdapter 를 kakaoSdk.js 가 직접 들고 있다(async 레지스트리 미사용)
    try { sdk = require('./business/kakaoSdk'); } catch (e) { sdk = null; }
    return sdk;
}

function all(): void { entries.slice().forEach(apply); }

function hook(): void {
    if (hooked) return;
    hooked = true;
    const s = getSdk();
    try { if (s && s.onSafeAreaChange) s.onSafeAreaChange(() => setTimeout(all, 0)); } catch (e) { /* ignore */ }
    if (typeof window !== 'undefined') window.addEventListener('resize', () => setTimeout(all, 100));
    // GNB 는 HF init 후 늦게 주입 → 실측 rect 로 한 번 더
    setTimeout(all, 1500);
    setTimeout(all, 4000);
}

function restore(it: Item): void {
    const { node, widget, base } = it;
    if (widget) {
        widget.left = base.left; widget.right = base.right; widget.top = base.top;
        widget.bottom = base.bottom; widget.horizontalCenter = base.hc;
        widget.updateAlignment();
    } else {
        node.setPosition(base.x, base.y);
    }
}

function shift(it: Item, dx: number, dy: number): void {
    const { node, widget } = it;
    let sx = 1, sy = 1;
    if (node.parent) {
        const s = node.parent.getWorldScale ? node.parent.getWorldScale(cc.v3()) : null;
        if (s) { sx = s.x || 1; sy = s.y || 1; }
    }
    const lx = dx / sx, ly = dy / sy;
    if (widget) {
        if (widget.isAlignLeft) widget.left += lx;
        if (widget.isAlignRight) widget.right -= lx;
        if (widget.isAlignHorizontalCenter) widget.horizontalCenter += lx;
        if (widget.isAlignTop) widget.top -= ly;
        if (widget.isAlignBottom) widget.bottom += ly;
        widget.updateAlignment();
        const hx = widget.isAlignLeft || widget.isAlignRight || widget.isAlignHorizontalCenter;
        const hy = widget.isAlignTop || widget.isAlignBottom || widget.isAlignVerticalCenter;
        node.setPosition(node.x + (hx ? 0 : lx), node.y + (hy ? 0 : ly));
    } else {
        node.setPosition(node.x + lx, node.y + ly);
    }
}

function apply(e: Entry): void {
    e.items = e.items.filter((it) => cc.isValid(it.node));
    if (!e.items.length) { const i = entries.indexOf(e); if (i >= 0) entries.splice(i, 1); return; }
    e.items.forEach(restore);
    if (typeof window === 'undefined' || window.innerWidth <= window.innerHeight) return; // 가로 전용
    const s = getSdk();
    if (!s || !s.getSafeArea) return;

    let bb: cc.Rect | null = null;
    for (const it of e.items) {
        if (!it.node.activeInHierarchy) continue;
        const label: any = it.node.getComponent(cc.Label);
        if (label && label._forceUpdateRenderData) label._forceUpdateRenderData();
        const b = it.node.getBoundingBoxToWorld();
        bb = bb ? bb.union(bb, b) : b;
    }
    if (!bb) return;

    const vs = cc.view.getVisibleSize();
    const f = vs.width / window.innerWidth; // CSS px → 디자인 좌표
    const sa = s.getSafeArea() || {};
    const nav = s.getNavRect ? s.getNavRect() : null;
    const m = MARGIN * f;

    let dx = 0, dy = 0;
    const L = (sa.left || 0) * f + ((sa.left || 0) > 0 ? m : 0);
    const R = vs.width - (sa.right || 0) * f - ((sa.right || 0) > 0 ? m : 0);
    if (bb.xMin < L) dx = L - bb.xMin;
    else if (bb.xMax > R) dx = R - bb.xMax;

    if (nav) {
        const nx0 = nav.left * f - m, nx1 = (nav.left + nav.width) * f + m;
        const ny1 = vs.height - nav.top * f + m, ny0 = vs.height - (nav.top + nav.height) * f - m;
        const x0 = bb.xMin + dx, x1 = bb.xMax + dx;
        if (x1 > nx0 && x0 < nx1 && bb.yMax > ny0 && bb.yMin < ny1) {
            const moveLeft = x1 - nx0;
            const moveDown = bb.yMax - ny0;
            if (moveLeft <= moveDown) dx -= moveLeft; else dy -= moveDown;
        }
    }
    if (!dx && !dy) return;
    e.items.forEach((it) => shift(it, dx, dy));
}

const { ccclass } = cc._decorator;

@ccclass
class KakaoSafeAnchor extends cc.Component {
    entry: Entry | null = null;
    private _pending = false;
    schedule1(): void {
        if (this._pending || !this.entry) return;
        this._pending = true;
        setTimeout(() => { this._pending = false; if (this.entry) apply(this.entry); }, 0);
    }
    // 등록 뒤에 켜지는 경우(부모 활성화) 컴포넌트 onEnable 로 잡는다
    onEnable(): void { this.schedule1(); }
}

export function keepInKakaoSafeArea(target: cc.Node | null | undefined | Array<cc.Node | null | undefined>): void {
    const nodes = (Array.isArray(target) ? target : [target]).filter((n) => !!n && cc.isValid(n)) as cc.Node[];
    if (!nodes.length) return;
    const e: Entry = {
        items: nodes.map((node) => {
            const widget = node.getComponent(cc.Widget);
            return {
                node, widget,
                base: {
                    left: widget ? widget.left : 0, right: widget ? widget.right : 0,
                    top: widget ? widget.top : 0, bottom: widget ? widget.bottom : 0,
                    hc: widget ? widget.horizontalCenter : 0, x: node.x, y: node.y,
                },
            };
        }),
    };
    entries.push(e);
    for (const node of nodes) {
        const anchor = (node.getComponent(KakaoSafeAnchor) || node.addComponent(KakaoSafeAnchor)) as KakaoSafeAnchor;
        anchor.entry = e;
        node.on('size-changed', () => anchor.schedule1());
    }
    hook();
    setTimeout(() => apply(e), 0);
}
