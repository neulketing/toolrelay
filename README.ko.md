# toolrelay

### 키 하나로, 에이전트가 필요한 모든 도구를.

**AI 에이전트용 오픈소스 도구 게이트웨이.** 하고 싶은 일로 검색하고, 가격을 보고, 부르면 됩니다.
업체 키는 서버 밖으로 나가지 않고, 못 찾은 호출은 0원입니다. Cloudflare 무료 플랜에 명령 한 줄로 올라갑니다.

[라이브 데모](https://toolrelay.azet.io) · [English](README.md)

## 왜 toolrelay 인가

- **업체가 아니라 일을 부른다** — `web.scrape`, `people.email.find` 처럼 부르면 키가 있는 업체를 싼 순서로 차례로 시도합니다.
- **못 찾으면 0원** — 결과가 없으면 과금하지 않고 다음 업체로 넘어갑니다. 답에만 돈을 냅니다.
- **키는 서버에만** — 에이전트는 잔액이 든 toolrelay 키 하나만 가집니다. 언제든 끊을 수 있습니다.
- **서버 0대** — Worker 하나 + D1 하나. 1분 안에 배포, 전 세계 300개 도시에서 응답.
- **에이전트 기본 탑재** — MCP, `llms.txt`, 일반 HTTP. Claude Code·Codex·Cursor 에 주소 하나만 주면 됩니다.
- **JSON 파일 하나로 업체 추가** — 주소·파라미터·가격·「찾음」 판정만 적으면 경로에 자동으로 합류합니다.
- **진짜 오픈** — MIT. 나·팀·고객 누구에게 서비스해도 됩니다.

## 1분 설치

```bash
git clone https://github.com/neulketing/toolrelay && cd toolrelay
npm i && npm run setup
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

사용법·라우팅 규칙·MCP 설정·카탈로그 전체는 [English README](README.md) 를 보세요.

MIT © [AZET](https://azet.io)
