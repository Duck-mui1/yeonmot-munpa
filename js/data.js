/* 연못 — 도깨비의 세계
 * 프로토타입용 예시 데이터 (실제 인물·연락처·계정 정보 없음)
 */
(function () {
  'use strict';

  window.YM_DATA = {
    guild: {
      name: '연못',
      game: '도깨비의 세계',
      motto: '물결이 모여 연못이 되고, 연못이 모여 강이 된다',
      level: 7,
      members: 24,
      capacity: 30,
      weeklyContribution: '12,480',
      weeklyAttendance: 21,
      newMembers: 3
    },

    notices: [
      {
        id: 'n1',
        pinned: true,
        tag: '축제',
        title: '연꽃 등불 축제 단체 참가 신청',
        author: '청연',
        role: '문주',
        daysAgo: 1,
        summary: '12월 첫 주에 열리는 연꽃 등불 축제에 문파 단체로 참가합니다.',
        body: [
          '모이는 시간은 축제 첫날 저녁 7시, 장소는 은빛 갈대밭 입구예요. 조금 늦으셔도 자리는 남겨둘게요.',
          '참가를 원하시는 분은 문파채팅에 “등불” 한마디만 남겨주세요. 인원을 모아 함께 들어가면 등불 하나를 나눠 받을 수 있어요.',
          '신청은 이번 달 말일까지 받습니다. 등불 색은 연분홍과 금빛 중에서 고를 수 있어요.'
        ]
      },
      {
        id: 'n2',
        pinned: true,
        tag: '공지',
        title: '주간 보스 원정 시간이 30분 늦춰집니다',
        author: '물결따라',
        role: '부문주',
        daysAgo: 2,
        summary: '이번 주부터 토요일 원정이 21:00에서 21:30으로 변경됩니다.',
        body: [
          '늦게 퇴근하시는 분들도 함께할 수 있도록 맞춘 시간이에요. 21:20까지 연못 입구 3구역에 모여주세요.',
          '시간이 맞지 않는 분은 다음 날 저녁에 따로 한 번 더 돌아요. 채팅방에 “늦참”이라고 남겨주시면 맞춰 갈게요.',
          '원정이 끝난 뒤에는 가볍게 결과 스크린샷을 남기고 해산합니다.'
        ]
      },
      {
        id: 'n3',
        pinned: false,
        tag: '환영',
        title: '이번 주 새로 오신 문파원을 환영해요',
        author: '반딧불이',
        role: '장로',
        daysAgo: 3,
        summary: '이번 주에 세 분이 새로 함께하게 되었습니다.',
        body: [
          '채팅방에서 먼저 인사 한마디 건네주시면 좋겠어요. 처음엔 다 어색한 법이니까요.',
          '처음 오셨다면 내정보의 “문파 생활 안내”를 한 번 읽어보시고, 궁금한 점은 편하게 물어보세요. 답해드리는 속도보다 함께하는 시간이 더 중요합니다.'
        ]
      }
    ],

    events: [
      {
        /* 매주 반복 예시 — 수 · 토 21:30 */
        repeat_weekly: true,
        repeat_weekdays: [3, 6],
        hour: 21,
        minute: 30,
        title: '주간 보스 원정',
        place: '연못 입구 · 3구역',
        tag: '원정',
        note: '21:20까지 모여주세요'
      },
      {
        days: 4,
        hour: 20,
        minute: 0,
        title: '문파 대항전',
        place: '달빛 투기장',
        tag: '대항전',
        note: '참가 인원 12명부터 출전'
      },
      {
        days: 11,
        hour: 19,
        minute: 0,
        title: '연꽃 등불 축제',
        place: '은빛 갈대밭 입구',
        tag: '축제',
        note: '문파 단체 참가'
      }
    ],

    coupons: [
      { code: 'YEONMOT11', until: '12.31' },
      { code: 'PONDMOON', until: '12.15' },
      { code: 'LOTUSFIRE', until: '12.07' }
    ],

    /* 공략 — 유튜브 영상 (체험 모드 예시 4개)
     *  실제 영상 주소가 없는 예시라서 썸네일 대신 연못 그림을 깔아 둡니다.
     *  실제 문파에서는 문주·문파원이 유튜브 주소를 넣으면 그 영상 썸네일이 뜹니다.
     */
    guides: [
      { id: 'g1', title: '연못 입문 — 첫 주간 보스까지', kind: 'moon' },
      { id: 'g2', title: '물그림자 2페이즈 물기둥 피하기', kind: 'boss' },
      { id: 'g3', title: '반딧불이 수풀 채집 루트 한 바퀴', kind: 'firefly' },
      { id: 'g4', title: '연꽃 등불 축제 준비물 정리', kind: 'lantern' }
    ],

    /* 문파원 자리비움 — 체험 모드 예시 2건
     *  fromDays/toDays 는 오늘 기준(음수 = 이미 시작됨). 실제 화면에서는 날짜를 그대로 보여 줍니다.
     */
    absences: [
      { name: '물결따라', fromDays: -1, toDays: 2, reason: '해외출장' },
      { name: '연잎위의고양이', fromDays: 5, toDays: 8, reason: '시험기간' }
    ],

    members: [
      { name: '청연', role: '문주', level: 62, status: 'on', last: '지금 접속 중' },
      { name: '물결따라', role: '부문주', level: 58, status: 'on', last: '지금 접속 중' },
      { name: '반딧불이', role: '장로', level: 54, status: 'on', last: '지금 접속 중' },
      { name: '연잎위의고양이', role: '장로', level: 51, status: 'away', last: '12분 전' },
      { name: '잉어왕', role: '정예', level: 47, status: 'on', last: '지금 접속 중' },
      { name: '연꽃등불', role: '정예', level: 45, status: 'on', last: '지금 접속 중' },
      { name: '밤안개', role: '정예', level: 44, status: 'off', last: '2시간 전' },
      { name: '수련', role: '문파원', level: 39, status: 'on', last: '지금 접속 중' },
      { name: '개구리단', role: '문파원', level: 38, status: 'away', last: '25분 전' },
      { name: '달빛조각', role: '문파원', level: 37, status: 'on', last: '지금 접속 중' },
      { name: '소금빛', role: '문파원', level: 35, status: 'off', last: '어제' },
      { name: '연못지기', role: '문파원', level: 34, status: 'on', last: '지금 접속 중' },
      { name: '물안개', role: '문파원', level: 33, status: 'off', last: '3시간 전' },
      { name: '버들가지', role: '문파원', level: 31, status: 'away', last: '40분 전' },
      { name: '흰수염도깨비', role: '문파원', level: 30, status: 'off', last: '어제' },
      { name: '조약돌', role: '문파원', level: 29, status: 'on', last: '지금 접속 중' },
      { name: '이끼', role: '문파원', level: 28, status: 'off', last: '어제' },
      { name: '늪지대장', role: '문파원', level: 27, status: 'away', last: '1시간 전' },
      { name: '초롱', role: '문파원', level: 26, status: 'off', last: '2일 전' },
      { name: '연근', role: '문파원', level: 24, status: 'off', last: '3일 전' },
      { name: '밤비', role: '문파원', level: 23, status: 'off', last: '5일 전' },
      { name: '물레방아', role: '문파원', level: 21, status: 'off', last: '1주 전' },
      { name: '산들바람', role: '문파원', level: 19, status: 'off', last: '1주 전' }
    ],

    album: [
      { id: 'a1', title: '달빛 아래 연못', author: '청연', daysAgo: 0, likes: 18, kind: 'moon',
        caption: '밤 11시, 연못 수면이 거울처럼 잠겼어요.\n달빛이 물 위에 한 줄로 내려앉은 걸 보고 한참 서 있었네요.' },
      { id: 'a2', title: '첫 주간 보스 클리어', author: '물결따라', daysAgo: 2, likes: 24, kind: 'boss',
        caption: '3트 만에 잡았습니다!' },
      { id: 'a3', title: '잉어 정령과 한 컷', author: '잉어왕', daysAgo: 3, likes: 15, kind: 'koi' },
      { id: 'a4', title: '문파 단체샷', author: '반딧불이', daysAgo: 5, likes: 31, kind: 'group' },
      { id: 'a5', title: '반딧불이 가득한 밤', author: '수련', daysAgo: 6, likes: 12, kind: 'firefly' },
      { id: 'a6', title: '연꽃 등불 만들기', author: '연꽃등불', daysAgo: 8, likes: 21, kind: 'lantern',
        caption: '연분홍 등불 완성! 다음 축제 때 달아 두려고요.' },
      { id: 'a7', title: '새벽 사냥터', author: '달빛조각', daysAgo: 10, likes: 9, kind: 'reed' },
      { id: 'a8', title: '물그림자 처치!', author: '잉어왕', daysAgo: 12, likes: 27, kind: 'wave' }
    ],

    chatSeed: [
      {
        id: 'c1',
        system: true,
        text: '연못 채팅방에 오신 것을 환영합니다. 서로의 속도를 존중해 주세요.'
      },
      { id: 'c2', name: '청연', role: '문주', minutesAgo: 96, text: '오늘 저녁 9시 반 원정, 갈 수 있는 분 손 한번 들어주세요 🌊' },
      { id: 'c3', name: '물결따라', role: '부문주', minutesAgo: 94, text: '저 갑니다. 21:20에 3구역에서 기다릴게요.' },
      { id: 'c4', name: '반딧불이', role: '장로', minutesAgo: 90, text: '저도요! 이번엔 도술서 챙겨갈게요.' },
      { id: 'c5', name: '연잎위의고양이', role: '장로', minutesAgo: 74, text: '2페이즈 물기둥 조심하세요. 옆으로 두 번 구르면 안전합니다.' },
      { id: 'c6', name: '청연', role: '문주', minutesAgo: 61, text: '새로 오신 분들도 편하게 인사 남겨주세요. 처음엔 다 어색한 법이니까요 🪷' },
      { id: 'c7', name: '잉어왕', role: '정예', minutesAgo: 44, text: '오늘 사냥터 물안개가 심하더라고요. 우비 도술 하나씩 챙기세요.' },
      { id: 'c8', name: '연꽃등불', role: '정예', minutesAgo: 28, text: '연등 축제 신청했어요~ 등불 색은 무슨 색으로 할까요?' },
      { id: 'c9', name: '수련', role: '문파원', minutesAgo: 12, text: '연분홍이요! 연못이랑 잘 어울릴 것 같아요.' }
    ],

    quickChat: ['원정 갈게요 🌊', '지금 접속했어요', '고마워요 🪷', '조금 늦을 것 같아요']
  };
})();
