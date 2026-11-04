import FxPlayer from "../../../framework/extension/fxplayer/FxPlayer";
import { UInfo } from "../../../framework/extension/weak_net_game/UInfo";
import mvcView from "../../../framework/ui/mvcView";
import { Toast } from "../../../framework/ui/ToastManager";
import ccUtil from "../../../framework/utils/ccUtil";
import { LocalizationManager } from "../../../framework/Hi5/Localization/LocalizationManager";
import { pdata } from "../data/PlayerInfo";
import { ImgConfirmData } from "./UIImgComfirm";
import InventoryUI from "../view/TopMostInventoryUI";

const { ccclass, property } = cc._decorator;

@ccclass
export default class UIDrawBox extends mvcView {
    @property([cc.Node])
    allBox: Array<cc.Node> = [];

    @property(cc.Node)
    btn_close: cc.Node = null;

    @property(cc.Label)
    numLabel: cc.Label = null;

    @property(cc.Node)
    hintNode: cc.Node = null;

    private rewardIdx = 0;

    private rewardData = null;

    private isOnDraw: boolean = false;
    onLoad() {
        this.rewardData = csv.drawBox.values;
        this.register(this.numLabel, () => Math.max(0, UInfo.drawResidueTime));
        this.onVisible(this.hintNode, () => {
            return UInfo.drawResidueTime <= 4 ? true : false;
        });
    }

    onShow() {
        this.initBox();
        this.render();
    }

    initBox() {
        this.allBox.forEach(v => {
            v.on(cc.Node.EventType.TOUCH_END, this.onBoxTouchEnd, this);
            v.getChildByName("box").active = true;
            v.getChildByName("reward").active = false;
            v.scale = 1;
        })
    }

    randomReward() {
        let max = this.rewardData.length;
        this.rewardIdx = Math.floor(Math.random() * max);
    }

    openBox(box: cc.Node) {
        this.allBox.forEach(v => {
            v.off(cc.Node.EventType.TOUCH_END, this.onBoxTouchEnd, this);
        });
        UInfo.drawResidueTime--;
        UInfo.save("drawResidueTime");
        let reward = this.rewardData[this.rewardIdx];

        let boxOff = box.getChildByName("box");
        let onNode = box.getChildByName("reward");
        let icon = ccUtil.find("reward/icon", box, cc.Sprite);
        let num = ccUtil.find("reward/num", box, cc.Label);
        let name = ccUtil.find("reward/name", box, cc.Label);

        let fxPlayer = box.getComponent(FxPlayer);
        onNode.active = true;
        boxOff.active = false;
        fxPlayer.play()
        let iconPath = reward.iconPath;
        if(reward.id > 3){
            name.string = LocalizationManager.getText("@currency.silver");
        }else{
            name.string = LocalizationManager.getText(`@prop.${reward.id}.name`);
        }
        // name.string = reward.name;
        num.string = "X" + reward.num.toString();
        ccUtil.setDisplay(icon, iconPath);
        let confirmData: ImgConfirmData = {
            title: LocalizationManager.getText("@text.congratulations"),
            // title: "恭喜获得",
            iconPath: iconPath,
            content: name.string + num.string,
            isShowCancel: false,
            cancelIsDaley: false,
            confirmCall: () => {
                if (this.rewardIdx > 3) {
                    pdata[this.rewardData[this.rewardIdx].saveKey] += this.rewardData[this.rewardIdx].num;
                } else {
                    pdata.buffs[this.rewardData[this.rewardIdx].saveKey] += this.rewardData[this.rewardIdx].num;
                }
                this.isOnDraw = false;
                this.initBox();
            },
            cancelCall: null
        }
        this.scheduleOnce(() => {
            vm.show("UIImgConfirm", confirmData);
        }, 0.3);
        pdata.save();
        this.render();
    }

    onBoxTouchEnd(e) {

        if (this.isOnDraw) {
            Toast.make(LocalizationManager.getText("@text.selecting_prize"));
            // Toast.make("正在挑选奖品！")
            return;
        }
        // 상자뽑기 하루 5회 제한 (릴레이 #133: 꺼져 있어 횟수가 마이너스로 내려가며 다이아로 계속 뽑혔음)
        if (UInfo.drawResidueTime <= 0) {
            Toast.make(LocalizationManager.getText("@text.draw_time_used_up"));
            return;
        }
        if (UInfo.drawResidueTime <= 4) {
            if (pdata.diamond < 5) {
                Toast.make(LocalizationManager.getText("@text.diamond_not_enough"));
                // Toast.make("钻石不足！");
                return
            }
            // 다이아 차감 위치 표시를 위해 클릭한 상자를 타겟으로 설정
            if (InventoryUI.instance) {
                InventoryUI.instance.setTarget(e.target);
            }
            pdata.diamond -= 5;
            pdata.save("diamond");
        }
        this.isOnDraw = true;
        this.randomReward();
        let box: cc.Node = e.target;
        cc.tween(box)
            .to(0.15, { scale: 1.3 })
            .delay(0.05)
            .call(() => {
                this.openBox(e.target);
            })
            .start()
    }

    onHidden() {
        this.allBox.forEach(v => {
            v.off(cc.Node.EventType.TOUCH_END, this.onBoxTouchEnd, this);
        });
        pdata.sendToServer("diamond,buffs");
    }

    private click_closes() {
        vm.hide(this);
    }
}
