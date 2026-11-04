import Signal from "../../core/Signal";
import { evt } from "../../core/event";
import ViewManager from "../../ui/ViewManager";

const { ccclass, property, menu } = cc._decorator;

export let Guider: GuiderLayer = null;
const DOUBLECLICK_TIMEOUT = 300;
const ACTION_MOVE_FINGER = 1000;

export interface GuideMessageOption {
    title?,
    content?,
    x?, y?, w?, h?
    confirmText?,
    cancelText?

}
/**
 * 层级关系
 * UIGuider
                focusArea
                    mask
                        maskbg
                    finger
                        sp
                msgbox
                    anykey
                    frame
                        title
                        content
                        buttons
                            btn_confirm
                                New Label
                            btn_cancel
                                New Label
 * 
 */
@ccclass
@menu("mimgame/deprecate/GuiderLayer")
export default class GuiderLayer extends cc.Component {
    _lastClickedTime: number = 0;

    /**whole hot rect -> contains 0.maskbackgrounds 1.hightlight 2.highlight_border 3.finger */
    @property(cc.Node)
    focusArea: cc.Node = null;
    //------------------------------------------------------------------------------//
    /** click_area(self)/ highlight_border /finger */
    @property(cc.Node)
    hotRect: cc.Node = null;

    @property(cc.Node)
    mask: cc.Node = null;
    @property(cc.Sprite)
    highlight_border: cc.Sprite = null;
    @property(cc.Node)
    finger: cc.Node = null;

    // @property(cc.Node)
    // glow: cc.Node = null;

    motionStreak: cc.MotionStreak = null;

    //------------------------------------------------------------------------------//

    @property(cc.Node)
    msgNode: cc.Node = null;

    @property(cc.Label)
    msgContentLabel: cc.Label = null;

    clickSignal: Signal = new Signal();
    clickBackground: Signal = new Signal();
    doubleClickSignal: Signal = new Signal();

    @property(cc.Node)
    maskbg: cc.Node = null;


    @property(cc.SpriteFrame)
    maskStencilSp1: cc.SpriteFrame = null;

    @property(cc.Label)
    msgTitleLabel: cc.Label = null;

    confirmLabel: cc.Label = null;

    @property(cc.Button)
    confirmButton: cc.Button = null;

    @property(cc.Button)
    cancelButton: cc.Button = null;

    cancelLabel: cc.Label = null;

    @property(cc.Node)
    node_anyKey: cc.Node = null;

    confirmCallback: Function = null;
    cancelCallback: Function = null;

    maskComp: cc.Mask = null;

    msgTitle: string = "";

    validRect: cc.Rect = null;

    lastFocusNode: cc.Node = null;

    onLoad() {
        this.maskComp = this.mask.getComponent(cc.Mask)


        this.cancelLabel = this.cancelButton.getComponentInChildren(cc.Label);
        this.confirmLabel = this.confirmButton.getComponentInChildren(cc.Label);

        this.hotRect.on(cc.Node.EventType.TOUCH_START, this.onPointTouchBegan, this)
        this.hotRect.on(cc.Node.EventType.TOUCH_END, this.onPointClick, this)

        this.maskbg.on(cc.Node.EventType.TOUCH_START, this.onTouchBegan, this);
        this.maskbg.on(cc.Node.EventType.TOUCH_END, this.clickBackground.fire, this.clickBackground)
        this.hideFocus()
        this.hideMessage();
        this.motionStreak = this.finger.getComponentInChildren(cc.MotionStreak);

        // 해상도에 맞게 maskbg 크기 조정
        this.updateMaskSize();
    }

    /**
     * maskbg 크기를 화면 크기에 맞게 업데이트
     */
    private updateMaskSize() {
        if (this.maskbg) {
            const width = Math.max(cc.winSize.width, cc.visibleRect.width) * 2;
            const height = Math.max(cc.winSize.height, cc.visibleRect.height) * 2;
            this.maskbg.setContentSize(Math.max(width, 3000), Math.max(height, 3000));
        }
    }

    onDestroy() {
        this.hotRect.off(cc.Node.EventType.TOUCH_END, this.onPointClick, this)
        this.maskbg.off(cc.Node.EventType.TOUCH_END, this.clickBackground.fire, this.clickBackground)
        this.hotRect.off(cc.Node.EventType.TOUCH_START, this.onPointTouchBegan, this)
        this.maskbg.off(cc.Node.EventType.TOUCH_START, this.onTouchBegan, this);
    }

    onShown() {

    }

    onPointTouchBegan(e) {
        return false
    }

    onTouchBegan(e) {
        if (!this.validRect) return false;
        let p = e.currentTouch.getLocation
        if (this.validRect.contains(p)) {
            //可穿透
            return false
        }
        return true;
    }

    hideMask() {
        this.maskbg.active = false;
    }

    showMask() {
        this.maskbg.active = true;
    }

    hideFocus() {
        // this.pointer.active = false;
        this.focusArea.x = -1000;
        // 카카오 가로 풀 화면(2.4:1 등)에선 x=-1000 이 화면 안이라 손가락이 왼쪽 끝에 남는다 → 손가락도 숨김
        if (this.finger) this.finger.active = false;
        this.maskbg.getComponent(cc.Widget).updateAlignment();
        this.motionStreak && this.motionStreak.reset();
    }

    hideRect() {
        if (this.highlight_border)
            this.highlight_border.node.active = false;
    }

    /**
     * is_clickArea : false 可以点击 到该 区域下面的控件，
     */
    showRect(rect: cc.Rect | string, is_clickArea?) {
        if (typeof (rect) == "string") {
            rect = this.findUINode(rect).getBoundingBoxToWorld();
        }
        let p = this.node.convertToNodeSpaceAR(rect.center);
        this.mask.width = rect.width;
        this.mask.height = rect.height;
        if (this.highlight_border) {
            this.highlight_border.node.width = rect.width + 2;
            this.highlight_border.node.height = rect.height + 2;
            this.highlight_border.node.active = true;
        }
        this.focusArea.active = true
        this.focusArea.x = p.x
        this.focusArea.y = p.y;
        this.validRect = rect;
        if (is_clickArea) {
            this.hotRect.width = rect.width;
            this.hotRect.height = rect.height;
        } else {
            this.hotRect.width = 0;
            this.hotRect.height = 0;
        }
        // 해상도에 맞게 maskbg 크기 업데이트
        this.updateMaskSize();
        this.maskbg.getComponent(cc.Widget).updateAlignment();
    }

    fingerTween: cc.Tween<cc.Node>;

    showFinger(bAnim = true) {
        this.finger.setPosition(0, 0)
        this.motionStreak && this.motionStreak.reset()
        this.finger.active = true;
        if (bAnim) {
            // this.finger.getComponent(cc.Animation).play("hand_click")
            this.fingerTween = cc.tween(this.finger).repeatForever(cc.tween(this.finger).to(0.3, { y: 10 }).to(0.3, { y: -10 })).start();
            // this.glow.active = true
        } else {
            if (this.fingerTween) {
                this.fingerTween.stop();
            }
            // this.glow.active = false;
        }
    }

    showFocus(node: cc.Node | cc.Vec2 = cc.Vec2.ZERO, simulate_click_area = true) {
        if (node instanceof cc.Node) {
            let rect = node.getBoundingBoxToWorld()
            this.showRect(rect, simulate_click_area);
            if (node.getComponent(cc.Sprite))
                this.maskComp.spriteFrame = node.getComponent(cc.Sprite).spriteFrame;
            else {
                if (this.maskStencilSp1)
                    this.maskComp.spriteFrame = this.maskStencilSp1;
            }
            this.lastFocusNode = node;
            this.showFinger();
        }
        this.showMask();
        // this.pointAvatar.children.forEach((v, i) => v.active = avatar == i)
    }

    hideMessage() {
        this.msgNode.active = false;
    }

    setMessageTitle(msgTitle: string) {
        this.msgTitle = msgTitle;
    }

    showMessage(msg: string, x?, y?, w?, h?) {
        msg = msg.replace(/\/r?\/n/g, "\n")
        this.msgNode.x = x || 0;
        this.msgNode.y = y || 0;
        this.msgNode.width = w;
        this.msgNode.height = h;
        this.msgNode.active = true;
        this.msgContentLabel.string = msg;
        if (this.msgTitle == null || this.msgTitle == "") {
            this.msgTitleLabel.node.active = false
        }
        else {
            this.msgTitleLabel.node.active = true;
            this.msgTitleLabel.string = this.msgTitle;
        }
        this.msgTitle = ""
        this.confirmButton.node.active = false
        this.node_anyKey.active = false;
    }

    private showConfirmButton(id: number, msg: string) {
        this.confirmButton.node.active = true;
        this.confirmLabel.string = msg;
        return new Promise((resolve, reject) => {
            this.confirmCallback = () => {
                resolve(id)
            };
        })

    }

    private showCancelButton(id: number, msg: string) {
        this.cancelButton.node.active = true;
        this.cancelLabel.string = msg;
        return new Promise((resolve, reject) => {
            this.cancelCallback = () => {
                resolve(id)
            };
        })

    }

    showMessageEx(options: GuideMessageOption) {
        this.setMessageTitle(options.title);
        this.showMessage(options.content, options.x, options.y, options.w, options.h)
        let ret_confirm, ret_cancel
        if (options.confirmText) {
            ret_confirm = this.showConfirmButton(1, options.confirmText);
        } else {
            this.confirmButton.node.active = false;
        }
        if (options.cancelText) {
            ret_cancel = this.showCancelButton(0, options.cancelText);
        } else {
            this.cancelButton.node.active = false;
        }
        if (!options.confirmText && !options.cancelText) {
            this.confirmButton.node.parent.active = false;
        }
        return Promise.race([ret_confirm, ret_cancel])
    }


    click_confirm() {
        this.hideMessage();
        this.confirmCallback && this.confirmCallback();
    }

    click_cancel() {
        this.hideMessage();
        this.cancelCallback && this.cancelCallback();
    }

    onPointClick() {
        let now = Date.now()
        let offset = now - this._lastClickedTime
        if (offset < DOUBLECLICK_TIMEOUT) {
            this.doubleClickSignal.fire();
        } else {
            this.clickSignal.fire();
        }
        this._lastClickedTime = now;
    }

    async waitClick(node: cc.Node, canTrigger = true, showHands = true): Promise<void> {
        this.showFocus(node);
        if (!showHands) {
            this.hideFinger()
        }
        // btn.clickEvents.
        return new Promise((resolve, reject) => {
            this.clickSignal.on(() => {
                if (canTrigger) {
                    let btn = node.getComponent(cc.Button) || node.getComponentInChildren(cc.Button);
                    try {
                        if (btn)
                            cc.Component.EventHandler.emitEvents(btn.clickEvents, { target: btn.node });
                        else {
                            node.emit(cc.Node.EventType.TOUCH_END, { target: node })
                        }
                    } catch (e) {
                        reject(e)
                    }
                    this.clickSignal.clear();
                }
                resolve();
            })
        })
    }

    async waitDoubleClick(node): Promise<void> {
        this.showFocus(node);
        return new Promise((resolve, reject) => {
            this.doubleClickSignal.on(() => {
                node.getComponents(cc.Component).forEach(v => {
                    let func = v['onDoubleClick'] as Function
                    if (func) {
                        func.call(v);
                    }
                })
                resolve();
            })
        })
    }

    async waitAnyKey(node?: cc.Node): Promise<void> {
        this.node_anyKey.active = true
        this.showMask();
        return new Promise((resolve, reject) => {
            this.clickBackground.on(() => {
                this.clickBackground.clear();
                resolve();
            })
            if (node) {
                this.waitClick(node, false, false).then(v => {
                    resolve();
                })
            }
        })
    }


    moveFinger(from: cc.Vec2, to: cc.Vec2, repeatTimes = cc.macro.REPEAT_FOREVER) {
        this.showFinger(false);

        from = this.hotRect.convertToNodeSpaceAR(from)
        to = this.hotRect.convertToNodeSpaceAR(to)
        from.subSelf(cc.v2(0, 50))
        to.subSelf(cc.v2(0, 50))
        let callback = cc.callFunc(v => {
            this.finger.setPosition(from)
            this.motionStreak && this.motionStreak.reset()
        })
        let move = cc.moveTo(1, to).easing(cc.easeSineInOut());
        let delay = cc.delayTime(1);
        let seq = cc.sequence(callback, move, delay).repeat(repeatTimes)
        seq.setTag(ACTION_MOVE_FINGER)
        this.finger.runAction(seq)
    }

    startDrag(from, to, showMask = true) {
        let fromNode = this.findUINode(from);
        let toNode = this.findUINode(to);
        let fromRect = fromNode.getBoundingBoxToWorld()
        let toRect = toNode.getBoundingBoxToWorld()
        if (showMask) {
            this.showMask();
            this.showRect(fromRect.union(cc.rect(), toRect));
        } else {
            this.hideMask();
            this.hideRect();
        }
        this.moveFinger(fromRect.center, toRect.center);
    }

    stopDrag() {
        this.finger.stopActionByTag(ACTION_MOVE_FINGER);
        this.hideFocus();
    }

    findUINode(path, type?): cc.Node {
        let node = null;
        if (type == "UI") {
            node = cc.find("Canvas/ViewManager/" + path);
        } else {
            node = cc.find(path);
        }
        return node
    }

    async waitClickEx(uipath: string | cc.Node, msgTitle?: string, msgContent?: string, x = 0, y = 0, anyKey?) {
        //11 
        //data1 为ui 路径 
        await evt.sleep(0.1);
        let node;
        if (uipath instanceof cc.Node) {
            node = uipath;
        } else {
            if (uipath == null) return console.error(`waitClickEx:${uipath} null `)
            node = this.findUINode(uipath);
            if (node == null) return console.error(`${uipath} not found `)
        }
        if (msgTitle)
            this.setMessageTitle(msgTitle);
        if (msgContent)
            this.showMessage(msgContent, x, y)
        this.showMask()
        if (anyKey) {
            this.showRect(node.getBoundingBoxToWorld());
            this.hideFinger();
            await this.waitAnyKey(node)
        } else {
            await this.waitClick(node).catch(e => console.error(e))
        }

        this.hideMask();
        this.hideFocus();
        this.hideMessage();
    }

    hideFinger() {
        this.finger.active = false;
    }

    hideAll() {
        this.hideMask();
        this.hideRect();
        this.hideFocus();
        this.hideMessage();
        this.hideFinger();
    }

    async waitAnyInput(title, content, x, y) {
        this.showMessage(title, content, x, y)
        this.hideFocus()
        this.hideMask();
        await this.waitAnyKey();
        this.hideMessage();
        await evt.sleep(0.3);
    }

    async waitOpen(uiName, open?, ...ps) {
        let view = ViewManager.instance.view("UI/" + uiName)
        if (view == null) {
            if (open) {
                vm.show("UI/" + uiName, ...ps)
            }
            [view] = await evt.wait(uiName + ".onShown")
        } else {
            vm.show(view, ...ps);
            [view] = await evt.wait(uiName + ".onShown")
        }
        return view;
    }

    waitClickUI(path, ...ps) {
        return this.waitClickEx("Canvas/ViewManager/" + path, ...ps);
    }

    waitClickLayoutUI(layoutpath, index, uipath) {
        let layout = cc.find("Canvas/ViewManager/" + layoutpath);
        if (layout) {
            let node
            if (uipath == null || uipath == "") {
                node = layout.children[index]
            } else {
                node = cc.find(uipath, layout.children[index])
            }
            if (node) {
                return this.waitClickEx(node)
            } else {
                console.warn("waitClickLayoutUI 자식 노드를 찾을 수 없음:" + uipath)
            }
        } else {
            console.warn("waitClickLayoutUI 레이아웃을 찾을 수 없음:   " + layoutpath)
        }
    }

}