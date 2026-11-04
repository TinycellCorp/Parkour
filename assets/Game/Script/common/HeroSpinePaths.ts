/**
 * 영웅 ID -> 스파인 리소스 경로 매핑
 * 전역으로 관리되는 매핑 테이블
 */
export const heroSpinePaths: { [id: string]: string } = {
    "1": "Textures/kakao/heros/01choonsik",
    "2": "Textures/kakao/heros/02Ryan",
    "3": "Textures/kakao/heros/06Frodo",      // 머스킷병
    "4": "Textures/kakao/heros/03Apeach",     // 마법사
    "5": "Textures/kakao/heros/08Jay-G",      // 망치신
    "6": "Textures/kakao/heros/04Tube",
    "7": "Textures/kakao/heros/05Muzi",       // 화염의 드래곤
    "8": "Textures/kakao/heros/07Neo",        // 마녀
};

/**
 * 인게임 캐릭터 크기 보정(춘식이 = 1). 영웅마다 스파인 원본 크기가 달라(라이언 높이 춘식이의 약 1.3배)
 * 같은 배율이면 큰 영웅으로 이어하기(부활) 시 캐릭터가 커 보인다(릴레이 #133).
 * 로비·부활창(heroItem/UIReviveItem heroScales, 춘식이 0.6 기준)과 같은 비율.
 */
export const heroInGameScale: { [id: string]: number } = {
    "1": 1, "2": 0.5 / 0.6, "3": 1, "4": 1, "5": 0.55 / 0.6, "6": 0.45 / 0.6, "7": 0.55 / 0.6, "8": 1,
};

/**
 * 영웅 ID로 스파인 경로 가져오기
 */
export function getHeroSpinePath(heroId: string): string | undefined {
    return heroSpinePaths[heroId];
}
