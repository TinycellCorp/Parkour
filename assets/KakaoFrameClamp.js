/**
 * 프레임 경과시간(dt) 상한 — 카카오 WebGL 가이드(2026-10-28) 2번 대응.
 *
 * 카카오톡 Android 웹뷰는 rAF 가 주기적으로 수백 ms 씩 밀린다. CC2 엔진의 dt 보정(1초 초과 → 1/60)은
 * CC_DEBUG 빌드에서만 동작해 라이브엔 상한이 없다 → 튄 dt 가 그대로 update(dt) 에 들어가 순간이동한다.
 * cc.director.calculateDeltaTime 을 감싸 상한을 넘은 시간은 버린다(clamp).
 */
(function () {
    /** 초. 메일 예시는 50ms 지만 저사양(10~20fps)이 슬로모션 되지 않도록 100ms. */
    var MAX_FRAME_DT = 0.1;
    var d = cc.director;
    if (!d || typeof d.calculateDeltaTime !== 'function' || d.__kakaoFrameClamp) return;
    var orig = d.calculateDeltaTime;
    d.calculateDeltaTime = function (now) {
        orig.call(this, now);
        if (this._deltaTime > MAX_FRAME_DT) this._deltaTime = MAX_FRAME_DT;
    };
    d.__kakaoFrameClamp = true;
})();
