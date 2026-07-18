# SYGMA OS 구조 분석 및 웹앱 설계 제안

작성일: 2026-05-16  
기준 페이지: https://www.notion.so/SYGMA-OS-2f48c1b30be8808b825be97344a13067

## 1. 요약

SYGMA OS는 단순한 개인 관리 페이지가 아니라 `수집 -> 분류 -> 계획 -> 실행/관리 -> 회고/아카이브` 흐름을 Notion 데이터베이스와 linked view로 구현한 개인 운영체제입니다.

핵심 데이터 모델은 `Boxes -> Goals -> Projects -> Tasks` 계층이며, `Resources`, `Journals`, `Bottlenecks`, `Captures`가 실행 흐름을 보조합니다. 이 구조 자체는 웹앱으로 옮길 가치가 높습니다. 다만 현재 구현은 Notion의 한계 때문에 같은 DB view를 여러 페이지에 반복 배치하고, DB 간 이동과 반복 습관, 계획 일정, 상태 계산을 수동 규칙과 formula/rollup에 의존합니다.

웹앱으로 만들 때는 Notion 화면 배치를 그대로 복제하지 말고, 데이터 모델과 사용 흐름을 보존해야 합니다. 특히 `Inbox`, `Today`, `Plan`, `Projects`, `Resources`, `Habits`, `Review`를 독립 화면으로 만들고, 내부에서는 같은 데이터를 여러 view 컴포넌트가 재사용하는 구조가 적합합니다.

## 2. 조사 범위

확인한 주요 범위는 다음과 같습니다.

- 루트 페이지: `SYGMA OS`
- 핵심 DB: `Captures`, `Boxes`, `Goals`, `Projects`, `Tasks`, `Resources`
- 보조 DB: `Daily Journal DB`, `WM Journal DB`, `Adjust & Management DB`, `Bottleneck DB`
- 주요 관리 페이지: `분류하기`, `계획하기`, `할 일 관리`, `자료 관리`, `목표 관리`, `프로젝트 관리`, `박스 관리`, `저널 관리`, `습관/루틴 관리`, `장애물 극복하기`, `일정 관리`, `아카이브`, `SYGMA Mobile`, `SYGMA OS 시작하기`
- 주요 템플릿/도우미: `새로운 박스`, `새 목표`, `새 프로젝트`, `새로운 할 일`, `목표 생성 도우미`, `습관만들기 템플릿`

주의: 모든 실제 데이터 행을 전수 열람한 것이 아니라, 웹사이트 설계에 필요한 page, database schema, view, template 구조를 중심으로 확인했습니다.

## 3. 현재 Notion 시스템의 정보 구조

### 3.1 핵심 데이터 계층

```text
Box
  Goal
    Project
      Task
  Resource
  Bottleneck
```

실제 구조는 완전한 트리라기보다 관계형 그래프입니다. `Task`, `Resource`, `Bottleneck`은 `Box`, `Goal`, `Project` 중 여러 엔티티와 연결될 수 있습니다.

### 3.2 핵심 DB 정리

| DB | 역할 | 주요 속성 | 웹앱에서의 해석 |
| --- | --- | --- | --- |
| Captures | 빠른 수집함 | 이름, URL | 모든 입력이 처음 도착하는 inbox |
| Boxes | 삶의 영역/컨테이너 | 이름, 구분, 목표, 프로젝트, 할 일, 자료 | 최상위 영역 또는 life area |
| Goals | 목표 | 이름, 연도, 분기, 목표 달성일, 진행상태, 박스, 프로젝트, 자료 | 장기/중기 outcome |
| Projects | 프로젝트 | 이름, 상태, 날짜, 목표, 박스, 할 일, 노트, 선후행, 장애물, 작업시간 | 기한과 산출물이 있는 실행 묶음 |
| Tasks | 할 일 | Task, 날짜, 구분, 중요/긴급, 완료, 프로젝트, 자료, 박스 | 실제 실행 단위 |
| Resources | 자료/노트 | 이름, URL, 분류, 중요도, 고정, 나중에 보기, 상위/하위 노트, 연결 엔티티 | 지식, 메모, 링크, 참고자료 |
| Daily Journal | 일간 회고 | 날짜, 감정, 만족도, 기록, 교훈 | 일간 리뷰 로그 |
| WM Journal | 주간/월간 회고 | 구분, 기간, 목표, 리뷰, 문제, 감사, 만족도 | 주간/월간 리뷰 |
| Bottleneck | 장애물 | 이름, 상태, 관련 목표/프로젝트/태스크/박스 | 막힘과 문제 해결 추적 |
| Adjust & Management | 관리 페이지 컨테이너 | 이름 | Notion 전용 내비게이션/페이지 저장소 |

### 3.3 화면/페이지 구조

루트 `SYGMA OS`는 홈 대시보드입니다. 좌측에는 수집, 루틴, 정리, 관리, 고정 자료가 있고 우측에는 할 일, 프로젝트 타임라인, 프로젝트, 목표, 자료, 박스, 관리도구, DB 링크가 있습니다.

주요 관리 페이지는 다음 역할을 합니다.

| 페이지 | 역할 |
| --- | --- |
| 분류하기 | Captures를 Task, Project, Resource, Goal, Box로 분류하는 작업대 |
| 계획하기 | 지연/미계획 업무와 프로젝트에 날짜를 배정하는 계획 화면 |
| 할 일 관리 | 할 일 목록과 캘린더 view |
| 자료 관리 | 고정, 미분류, 최근, 나중에 보기, 전체 자료 view |
| 목표 관리 | 현재 목표, 목표별 프로젝트, 완료/중단 목표 |
| 프로젝트 관리 | 진행 중, 집중, 지연, 미계획, 전체 프로젝트, 프로젝트 캘린더 |
| 박스 관리 | 고정 박스, 일반 박스, 전체 박스 |
| 저널 관리 | 월간, 주간, 데일리 저널 |
| 습관/루틴 관리 | 반복 습관/루틴과 차트 |
| 장애물 극복하기 | Bottleneck 생성 및 관리 |
| 일정 관리 | 일정성 Task view |
| 아카이브 | 완료/중단/아카이브된 모든 항목 모음 |
| SYGMA Mobile | 모바일에서 빠르게 추가하고 확인하는 경량 페이지 |

### 3.4 사용 흐름

현재 시스템의 실제 사용 흐름은 다음과 같습니다.

1. `Captures` 또는 빠른 추가 버튼으로 항목을 수집한다.
2. `분류하기` 페이지에서 수집 항목을 할 일, 프로젝트, 자료, 목표, 박스로 나눈다.
3. `계획하기` 페이지에서 미계획/지연된 업무와 프로젝트에 날짜를 붙인다.
4. `Today`, `할 일`, `프로젝트`, `자료`, `목표` view에서 실행한다.
5. `저널`, `장애물`, `습관/루틴`으로 실행 품질을 관리한다.
6. 완료/중단/아카이브 항목은 별도 페이지에서 보관한다.

## 4. 그대로 가져가면 좋은 점

### 4.1 Box -> Goal -> Project -> Task 계층

이 구조는 유지하는 것이 좋습니다. `Box`는 삶의 영역, `Goal`은 원하는 변화, `Project`는 변화로 가는 실행 묶음, `Task`는 지금 할 수 있는 행동으로 잘 분리되어 있습니다.

웹앱에서는 이 계층을 더 명확하게 만들 수 있습니다.

- Box: 영역
- Goal: 결과 목표
- Project: 산출물 또는 완료 기준이 있는 묶음
- Task: 실행 가능한 단일 행동

### 4.2 Resource를 실행 맥락에 연결하는 방식

자료 DB가 단순 스크랩 보관소가 아니라 목표, 프로젝트, 태스크, 박스와 연결됩니다. 이는 유지해야 합니다. 웹앱에서는 자료를 독립 노트로 두되, 어떤 실행 맥락에서 필요한 자료인지 바로 볼 수 있어야 합니다.

### 4.3 Inbox와 분류 단계

수집과 실행을 분리한 것이 좋습니다. 개인 관리 앱에서 중요한 것은 빠른 입력과 나중의 정리입니다. 웹앱에서도 `Inbox`를 첫급 시민으로 두고, `Convert to Task`, `Convert to Project`, `Convert to Resource`, `Attach to existing` 같은 액션을 제공해야 합니다.

### 4.4 계획하기 페이지의 존재

`계획하기`는 Notion 시스템에서 가장 중요한 작업대입니다. 지연된 업무, 미계획 업무, 이번 주/이번 달 업무, 프로젝트 캘린더를 한 화면에서 다룹니다. 웹앱에서는 이 화면을 더 강하게 만들어야 합니다.

### 4.5 Bottleneck 모델

장애물을 별도 DB로 둔 것은 좋은 설계입니다. 목표/프로젝트/태스크가 지연되는 이유를 구조적으로 남길 수 있습니다. 웹앱에서는 `Blocked reason`, `Next unblock action`, `Resolved at` 같은 속성을 추가하면 더 실용적입니다.

### 4.6 도우미/템플릿

목표 생성 도우미와 습관 생성 도우미는 웹앱에서 wizard로 바꾸기 좋습니다. 긴 설명 페이지를 그대로 옮기기보다 단계별 질문, 저장, 나중에 이어쓰기, 최종 엔티티 생성으로 바꾸는 것이 적합합니다.

## 5. Notion 구조 때문에 비효율적인 점

### 5.1 같은 DB view가 너무 많이 복제됨

홈, 관리 페이지, 상세 템플릿, 모바일 페이지에서 동일 DB를 다른 필터로 반복 배치합니다. Notion에서는 어쩔 수 없지만 웹앱에서는 데이터는 하나이고 view만 달라야 합니다.

웹앱 대안:

- 공통 query layer
- 저장된 filter preset
- 같은 컴포넌트 재사용
- 화면별 view state만 분리

### 5.2 DB 간 drag/drop 이동 규칙이 취약함

`수집함에서 다른 DB로 옮기는 것은 가능 / 수집함을 제외한 DB에서 다른 DB로 옮기지 말라`는 규칙은 Notion DB 간 속성 호환성 문제 때문입니다.

웹앱 대안:

- Capture는 원본으로 유지
- 변환 시 새 엔티티를 생성하고 원본 Capture를 `processed` 처리
- 변환 기록 보관
- 잘못 변환한 항목은 undo 가능

### 5.3 Task DB가 너무 많은 역할을 떠안음

Tasks에 일반 할 일, 일정, 위임, 저널, 습관/루틴이 함께 들어 있습니다. Notion에서는 반복 템플릿과 linked view 때문에 이렇게 된 것으로 보입니다.

웹앱 대안:

- Task는 실행 단위로 유지
- Habit은 `habits`와 `habit_instances`로 분리
- Journal은 `journals` 또는 `reviews`로 분리
- 시각이 필요한 외부 일정은 Task가 아니라 Calendar event로 분리

### 5.4 Task는 날짜 단위로 배치

Task는 실행 날짜만 가지며 시작·종료 시각이나 예상 소요 시간을 저장하지 않습니다.

웹앱 대안:

- Task는 `due_date` 하나만 사용
- 시각이 필요한 일정은 Google Calendar event로 관리

### 5.5 `예정`과 `나중에` 상태 통합

`나중에(someday)`는 날짜가 정해지지 않은 `예정(scheduled)`과 의미가 겹치므로 별도 Task 상태로 두지 않습니다.

웹앱 기준:

- Todo: 아직 완료되지 않은 기본 실행 상태이며, 배정 여부는 상태가 아니라 `due_date` 유무로 판단
- Scheduled: 의도적으로 예정 처리한 할 일이며 `due_date`는 선택 사항
- Waiting: 외부 응답을 기다리는 할 일
- Reminder: 별도 상태가 아니라 Task 날짜 또는 Calendar event로 표현
- Backlog: 프로젝트나 목표에 연결된 기본 `할 일(todo)`로 표현

따라서 미계획 Task는 `due_date`가 없고 `scheduled`가 아닌 항목으로 계산합니다.

### 5.6 Formula/Rollup에 핵심 로직이 숨어 있음

D-day, 달성률, 시간 계산, 알림, 필터날짜 등이 Notion formula/rollup에 의존합니다. 웹앱에서는 이를 숨은 속성이 아니라 명시적 계산 로직으로 관리해야 합니다.

웹앱 대안:

- 서버 계산 함수
- materialized stats
- activity log 기반 작업 시간 집계
- 테스트 가능한 business logic

### 5.7 모바일 페이지가 별도 복제됨

SYGMA Mobile은 빠른 추가와 몇 개 view를 따로 둔 페이지입니다. 웹앱에서는 반응형 레이아웃과 모바일 전용 액션 바로 해결하는 편이 낫습니다.

### 5.8 페이지 템플릿이 앱 플로우 역할을 대신함

새로운 박스, 새 목표, 새 프로젝트 페이지는 사용 가이드와 linked view를 포함합니다. 웹앱에서는 상세 페이지, create form, onboarding guide를 분리해야 합니다.

## 6. 웹사이트 권장 정보 구조

### 6.1 최상위 내비게이션

추천하는 최상위 화면은 다음과 같습니다.

| 화면 | 목적 | 핵심 기능 |
| --- | --- | --- |
| Today | 오늘 실행 | 오늘 할 일, 루틴, 지연 항목, 빠른 수집, 집중 프로젝트 |
| Inbox | 수집/분류 | 빠른 입력, URL 저장, capture 변환, 일괄 분류 |
| Plan | 계획 | 미계획/지연 항목, 주간/월간 캘린더, 프로젝트 타임라인 |
| Tasks | 실행 단위 관리 | 필터, 완료, 일정, 예정/대기 |
| Projects | 프로젝트 관리 | 상태, 진행률, 타임라인, 연결 task/resource |
| Goals | 목표 관리 | 연/분기 목표, 진행률, 목표별 프로젝트 |
| Boxes | 삶의 영역 | 고정/일반/아카이브 영역, 영역별 요약 |
| Resources | 자료/노트 | 고정, 미분류, 최근, 나중에 보기, 검색 |
| Habits | 루틴 | 반복 규칙, 오늘 체크, streak, 실패/대체 계획 |
| Journal | 회고 | 데일리/위클리/먼슬리 리뷰 |
| Obstacles | 막힘 관리 | 중요한 문제, 사소한 문제, 해결됨 |
| Archive | 보관 | 완료/중단/아카이브 전체 |
| Settings | 시스템 관리 | 태그, 상태값, 가져오기/내보내기, Notion 동기화 |

### 6.2 첫 화면

첫 화면은 소개 페이지가 아니라 `Today`가 되어야 합니다.

권장 구성:

- 상단: 오늘 날짜, 완료율, 예정 시간, 빠른 입력
- 좌측: 오늘 할 일과 루틴
- 중앙: 시간순 일정/작업
- 우측: 지연 항목, 집중 프로젝트, 오늘 볼 자료
- 하단: 오늘 저널 작성 CTA

### 6.3 Inbox 화면

Inbox는 이 앱의 중심입니다.

필요 기능:

- 한 줄 빠른 입력
- URL 붙여넣기
- capture type 자동 제안
- `Task`, `Project`, `Resource`, `Goal`, `Box`로 변환
- 관련 Box/Goal/Project 자동 추천
- 처리됨, 보류, 삭제 상태

### 6.4 Plan 화면

Plan은 Notion의 `계획하기`를 대체하는 핵심 화면입니다.

필요 기능:

- 미계획 Task
- 지연 Task
- 날짜 없는 예정/Reminder 재검토
- 미계획 Project
- 프로젝트 타임라인
- 이번 주 캘린더
- drag/drop 일정 배치
- 일괄 날짜 변경

### 6.5 상세 페이지 구조

각 엔티티 상세 페이지는 다음처럼 구성합니다.

Box detail:

- 기본 정보
- 연결 목표
- 진행 중 프로젝트
- 오늘/이번 주 할 일
- 고정 자료
- 관련 장애물

Goal detail:

- 목표 정의
- deadline, year, quarter, status
- 연결 프로젝트
- 진행률
- 관련 자료
- 장애물
- 회고 로그

Project detail:

- 프로젝트 목표/완료 기준
- 기간/상태/우선순위
- 할 일 목록
- 자료
- 장애물
- 작업 시간
- 선후행 프로젝트

Task detail:

- 제목
- 상태/완료
- 날짜
- 구분
- 중요/긴급
- 연결 프로젝트/자료/박스
- 메모

## 7. 권장 데이터 모델

### 7.1 핵심 테이블

```text
users
boxes
goals
projects
tasks
resources
captures
habits
habit_instances
journals
reviews
obstacles
tags
entity_links
activity_logs
```

### 7.2 주요 필드 제안

`boxes`

- id
- name
- description
- visibility: pinned | normal | archived
- color
- icon
- archived_at

`goals`

- id
- box_id
- name
- description
- year
- quarter
- target_date
- status: not_started | active | focus | paused | completed | canceled
- success_criteria
- archived_at

`projects`

- id
- goal_id
- box_id
- name
- description
- status: unplanned | planned | active | focus | paused | completed | canceled
- start_date
- end_date
- due_date
- completion_criteria
- parent_project_id
- archived_at

`tasks`

- id
- project_id
- goal_id
- box_id
- title
- note
- status: todo | scheduled | doing | waiting | done | canceled
- kind: focus | normal | easy | delegated | event
- priority_matrix: important_urgent | important_not_urgent | not_important_urgent | not_important_not_urgent | routine
- due_date
- completed_at
- assignee_text

`resources`

- id
- title
- summary
- body
- url
- type: quick_note | note | scrap | thought | reflection
- importance: normal | important | archived
- pinned
- read_later
- parent_resource_id
- created_at
- updated_at

`captures`

- id
- raw_text
- url
- suggested_type
- status: inbox | processed | dismissed
- converted_entity_type
- converted_entity_id
- created_at
- processed_at

`habits`

- id
- name
- box_id
- project_id
- resource_id
- recurrence_rule
- default_scheduled_time
- active
- reward
- fallback_plan

`habit_instances`

- id
- habit_id
- scheduled_for
- completed_at
- skipped_at
- note

`obstacles`

- id
- title
- description
- severity: major | minor
- status: open | resolved | archived
- next_action
- resolved_at

`entity_links`

- id
- source_type
- source_id
- target_type
- target_id
- relation_type

이 `entity_links` 테이블은 Notion의 relation/rollup을 대체합니다. 자료, 장애물, 태스크를 여러 엔티티에 연결할 수 있게 합니다.

## 8. MVP 개발 순서

### Phase 1: 개인 실행 코어

- Today
- Inbox
- Tasks
- Boxes
- 기본 CRUD
- Capture -> Task/Resource 변환
- 간단한 local search

### Phase 2: 목표/프로젝트 계층

- Goals
- Projects
- Box/Goal/Project/Task 관계
- 프로젝트 상세 내 할 일 관리
- 목표별 진행률 계산

### Phase 3: 계획 화면

- Plan 화면
- 미계획/지연 필터
- 주간 캘린더
- 프로젝트 타임라인
- drag/drop 일정 배치

### Phase 4: 자료와 회고

- Resources
- Markdown 또는 rich text editor
- Journal
- Weekly/Monthly review
- 자료와 작업 연결

### Phase 5: 습관과 장애물

- Habits
- Recurrence
- Habit instances
- Streak/차트
- Obstacles
- 막힘 해결 플로우

### Phase 6: 가져오기/동기화

- Notion export/import
- CSV import
- Notion API sync 가능성 검토
- 백업/복원

## 9. 권장 기술 스택

현재 비어 있는 프로젝트에서 새 웹앱을 만든다면 다음 구성이 적합합니다.

- Framework: Next.js + TypeScript
- Styling: Tailwind CSS
- DB: PostgreSQL
- ORM: Prisma
- Table: TanStack Table
- Calendar: FullCalendar 또는 React Big Calendar
- Editor: Tiptap
- Auth: Better Auth 또는 Auth.js
- Search: Postgres full-text search로 시작, 이후 Meilisearch/Typesense 검토

초기에는 복잡한 실시간 협업이나 과한 자동화를 넣지 않는 것이 좋습니다. 개인용 관리 도구이므로 데이터 모델, 입력 속도, 조회/필터 UX가 더 중요합니다.

## 10. 설계 원칙

1. Notion의 화면 배치가 아니라 사용 흐름을 복제한다.
2. 데이터는 한 번 저장하고, view는 여러 개 만든다.
3. 수집과 실행을 분리한다.
4. `예정`과 `나중에`를 중복 상태로 만들지 않고, `대기`는 외부 응답 의미로만 사용한다.
5. 습관은 Task 템플릿이 아니라 별도 모델로 둔다.
6. Formula/Rollup은 테스트 가능한 앱 로직으로 바꾼다.
7. 모바일은 별도 페이지 복제가 아니라 반응형 UX로 해결한다.
8. 목표 생성/습관 생성 도우미는 wizard로 바꾼다.

## 11. 우선 결정해야 할 질문

1. 이 웹앱은 개인 로컬 앱인가, 로그인 기반 클라우드 앱인가?
2. Notion과 계속 동기화할 것인가, 한 번 가져온 뒤 독립 앱으로 갈 것인가?
3. 자료 본문은 Markdown으로 충분한가, Notion처럼 block editor가 필요한가?
4. 캘린더는 내부 일정만 관리할 것인가, Google/Apple Calendar 연동이 필요한가?
5. 모바일 입력 속도를 위해 PWA까지 갈 것인가?

## 12. 결론

SYGMA OS에서 가장 가치 있는 것은 복잡한 Notion 레이아웃이 아니라 `수집 -> 분류 -> 계획 -> 실행 -> 회고`의 흐름과 `Box -> Goal -> Project -> Task`의 계층입니다. 웹앱에서는 이 흐름을 유지하되, Notion의 반복 view, DB 이동 제약, formula 의존, 템플릿 복제 방식은 제거해야 합니다.

추천 방향은 `Today`, `Inbox`, `Plan`을 중심으로 한 실행형 개인 운영체제입니다. 이후 `Projects`, `Goals`, `Resources`, `Habits`, `Journal`, `Obstacles`를 붙이면 현재 Notion 시스템보다 빠르고 안정적인 웹사이트가 됩니다.
