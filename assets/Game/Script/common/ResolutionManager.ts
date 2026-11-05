/**
 * ResolutionManager - 반응형 해상도 관리자
 *
 * 다양한 디바이스(태블릿/패드/서피스/폴드)에 대응하는 해상도 관리
 *
 * 사용법:
 *   ResolutionManager.init(); // 게임 시작 시 호출
 *   ResolutionManager.applyToCanvas(canvas); // 각 씬의 Canvas에 적용
 */

const { ccclass } = cc._decorator;

export enum DeviceType {
    PHONE = "phone",           // 일반 폰 (16:9 이상)
    TABLET = "tablet",         // 태블릿 (4:3 ~ 16:10)
    FOLDABLE = "foldable",     // 폴더블 (펼침 상태, ~1.2:1)
    FOLDABLE_CLOSED = "foldable_closed" // 폴더블 (접힘 상태, ~2.5:1)
}

export interface ResolutionInfo {
    width: number;
    height: number;
    ratio: number;
    deviceType: DeviceType;
    isLandscape: boolean;
}

@ccclass
export default class ResolutionManager {
    private static _instance: ResolutionManager = null;
    private static _resolutionInfo: ResolutionInfo = null;

    /**
     * 해상도 관리자 초기화
     */
    static init(): void {
        this._resolutionInfo = this.detectResolution();
        console.log('[ResolutionManager] 초기화:', this._resolutionInfo);

        // 화면 크기 변경 감지
        cc.view.setResizeCallback(() => {
            this._resolutionInfo = this.detectResolution();
            console.log('[ResolutionManager] 해상도 변경:', this._resolutionInfo);
            cc.director.emit('resolution:changed', this._resolutionInfo);
        });
        this.startRotateWatchdog();
    }

    /**
     * 회전 감시 — 가로 전용 게임이라 세로 화면에선 엔진이 화면을 90° 돌려 그린다.
     * 실기기(아이패드 카카오톡)에서 회전 이벤트가 창 크기 갱신보다 먼저 오면 엔진이 이전 크기로 굳어
     * 화면이 반쯤 잘려 보였다(릴레이 #133-33). 이벤트 순서에 기대지 않고 0.5초마다 창 크기와 엔진 프레임을
     * 비교해, 창 크기가 바뀐 뒤 어긋나 있을 때만(창 크기 변화당 최대 6회) 다시 맞춘다.
     */
    private static _watchdog: any = null;
    private static startRotateWatchdog(): void {
        if (this._watchdog || typeof window === 'undefined') return;
        let lastKey = '', retries = 0;
        this._watchdog = setInterval(() => {
            try {
                const W = window.innerWidth, H = window.innerHeight;
                if (!W || !H) return;
                const key = W + 'x' + H;
                if (key !== lastKey) { lastKey = key; retries = 6; }
                if (retries <= 0) return;
                const f = cc.view.getFrameSize();
                const rotated = W < H; // 세로 화면 → 엔진이 돌려 그림, 프레임은 가로·세로가 바뀐 값
                const ew = rotated ? H : W, eh = rotated ? W : H;
                if (Math.abs(f.width - ew) <= 2 && Math.abs(f.height - eh) <= 2) { retries = 0; return; }
                retries--;
                const v: any = cc.view;
                if (typeof v._resizeEvent === 'function') v._resizeEvent(true);
            } catch (e) { /* noop */ }
        }, 500);
    }

    /**
     * 현재 해상도 정보 반환
     */
    static get info(): ResolutionInfo {
        if (!this._resolutionInfo) {
            this._resolutionInfo = this.detectResolution();
        }
        return this._resolutionInfo;
    }

    /**
     * 현재 디바이스 타입 반환
     */
    static get deviceType(): DeviceType {
        return this.info.deviceType;
    }

    /**
     * 해상도 감지 및 디바이스 타입 결정
     */
    private static detectResolution(): ResolutionInfo {
        const frameSize = cc.view.getFrameSize();
        const width = Math.max(frameSize.width, frameSize.height);
        const height = Math.min(frameSize.width, frameSize.height);
        const ratio = width / height;
        const isLandscape = frameSize.width > frameSize.height;

        let deviceType: DeviceType;

        if (ratio >= 2.0) {
            // 매우 긴 화면 (폴더블 접힘, 21:9 폰)
            deviceType = DeviceType.FOLDABLE_CLOSED;
        } else if (ratio >= 1.7) {
            // 일반 폰 (16:9 ~ 19.5:9)
            deviceType = DeviceType.PHONE;
        } else if (ratio >= 1.4) {
            // 태블릿 (16:10, 3:2)
            deviceType = DeviceType.TABLET;
        } else {
            // 폴더블 펼침 또는 4:3 태블릿
            deviceType = ratio < 1.3 ? DeviceType.FOLDABLE : DeviceType.TABLET;
        }

        return { width, height, ratio, deviceType, isLandscape };
    }

    /**
     * Canvas에 반응형 설정 적용 — 인게임(Game._applyAdaptiveResolution)과 같은 적응형.
     * 디자인보다 가로로 넓으면 높이고정, 아니면 기존 SHOW_ALL 유지(4:3 에서 너비고정+cover 는 로고가 잘림). SHOW_ALL 은 와이드 폰에서
     * 좌우 검은 띠를 만들어 카카오 풀 화면 대응에 걸린다(릴레이 #130 접속 로딩).
     * 배경은 늘리지 않고 비율 유지로 화면을 덮는다(coverBackground).
     */
    static applyToCanvas(canvas: cc.Canvas): void {
        if (!canvas) {
            console.warn('[ResolutionManager] Canvas가 null입니다.');
            return;
        }
        const design = canvas.designResolution;
        const frame = cc.view.getFrameSize();
        const wide = frame.width / frame.height >= design.width / design.height;
        canvas.fitHeight = true;
        canvas.fitWidth = !wide;
        console.log(`[ResolutionManager] Canvas 설정 적용: ${wide ? 'FIXED_HEIGHT' : 'SHOW_ALL'}`);
    }

    /** 배경 노드를 Widget 늘이기 대신 비율 유지 cover 스케일로 화면 전체에 맞춘다. */
    static coverBackground(node: cc.Node, designW: number, designH: number): void {
        if (!node) return;
        const fr = cc.view.getFrameSize();
        if (fr.width / fr.height < designW / designH) return; // 좁은 화면은 SHOW_ALL 그대로(Widget 유지)
        const w = node.getComponent(cc.Widget);
        if (w) w.enabled = false;
        const vs = cc.view.getVisibleSize();
        node.setContentSize(designW, designH);
        node.setPosition(0, 0);
        node.scale = Math.max(vs.width / designW, vs.height / designH);
    }

    /**
     * 현재 씬의 Canvas에 자동 적용
     */
    static applyToCurrentScene(): void {
        const canvas = cc.Canvas.instance;
        if (canvas) {
            this.applyToCanvas(canvas);
        }
    }

    /**
     * 디바이스 타입에 따른 UI 스케일 반환
     */
    static getUIScale(): number {
        switch (this.deviceType) {
            case DeviceType.TABLET:
            case DeviceType.FOLDABLE:
                return 1.2; // 태블릿/폴더블에서 UI 약간 확대
            case DeviceType.FOLDABLE_CLOSED:
                return 0.9; // 접힌 폴더블에서 UI 약간 축소
            default:
                return 1.0;
        }
    }

    /**
     * Safe Area 여백 계산 (노치/펀치홀 대응)
     */
    static getSafeAreaMargin(): { top: number; bottom: number; left: number; right: number } {
        // 기본 여백 (필요시 플랫폼별 조정)
        const margin = { top: 0, bottom: 0, left: 0, right: 0 };

        // 긴 화면 디바이스는 좌우 여백 추가
        if (this.info.ratio >= 2.0) {
            margin.left = 40;
            margin.right = 40;
        }

        return margin;
    }

    /**
     * 디바이스 정보 문자열 반환 (디버깅용)
     */
    static getDebugInfo(): string {
        const info = this.info;
        return `[${info.deviceType}] ${info.width}x${info.height} (${info.ratio.toFixed(2)})`;
    }
}
