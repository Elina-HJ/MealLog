# MealLog를 GitHub와 Supabase에 연결하기

아래 순서대로 진행하세요. Supabase는 식사 기록과 로그인을 담당하고, GitHub는 앱 코드를 보관합니다. 사용자가 접속할 웹 주소를 만들려면 별도의 정적 호스팅 서비스도 필요합니다.

## 1. 기존 기록 백업

현재 `file://`로 열어 쓰던 앱에서 우측 상단 내보내기 버튼을 눌러 JSON 백업을 저장합니다. 배포한 웹 주소의 브라우저 저장공간은 기존 `file://` 저장공간과 별개라서, 백업을 가져와야 예전 기록을 옮길 수 있습니다.

## 2. Supabase 데이터베이스 설정

1. Supabase 대시보드에서 사용할 프로젝트를 엽니다.
2. **SQL Editor**를 열고 이 폴더의 `supabase-schema.sql` 전체를 붙여 넣어 실행합니다.
3. 프로젝트의 **Project URL**과 **Publishable key**를 확인합니다. `service_role` 또는 secret key는 사용하지 마세요.

## 3. 앱에 공개 연결값 입력

`supabase-config.js`에서 `url`과 `publishableKey`의 빈 문자열에 방금 확인한 값을 입력합니다. Publishable key는 브라우저 앱에 넣는 공개 키입니다. 식사 데이터를 보호하는 핵심은 데이터베이스의 RLS 정책이며, 위 SQL이 사용자별 접근을 제한합니다.

## 4. GitHub에 코드 올리기

MealLog 폴더를 GitHub 저장소에 올리고 변경 파일을 커밋·푸시합니다. 현재 이 폴더에는 Git 저장소 연결이 설정되어 있지 않으므로, GitHub 웹사이트에서 저장소를 만들거나 이미 만든 저장소를 이 폴더와 연결해야 합니다. 호스팅 서비스를 GitHub 저장소와 연결하면 이후 푸시 때 변경 사항을 자동 배포할 수 있습니다.

올릴 파일에는 `index.html`, `app.js`, `styles.css`, `account.css`, `supabase-config.js`, `supabase-schema.sql`, `sw.js`, `manifest.webmanifest`, `icon.svg`가 포함되어야 합니다. 비밀번호, Supabase secret/service_role key, 개인 기록 JSON은 저장소에 올리지 마세요.

## 5. 웹 주소로 배포

GitHub Pages를 쓰려면 저장소의 **Settings → Pages**에서 배포 원본을 `Deploy from a branch`로 두고 `main` 브랜치의 `/ (root)`를 선택해 저장합니다. 잠시 후 `https://<계정>.github.io/<저장소>/` 주소가 생깁니다. Netlify 등 다른 정적 호스팅을 써도 됩니다. 이 앱은 정적 파일 앱이라 빌드 명령은 필요하지 않습니다. 배포 주소는 `https://...` 형식이어야 합니다.

## 6. 로그인 주소 등록

Supabase의 **Authentication → URL Configuration**에서 배포된 HTTPS 주소를 Site URL로 설정하고, Redirect URLs에는 배포 주소 전체 경로를 허용하도록 추가합니다(예: `https://<계정>.github.io/<저장소>/**`). 그 다음 배포 주소에서 MealLog를 열어 계정을 만들고 로그인합니다. 기존 백업이 있으면 로그인 전에 **JSON 백업 가져오기**로 가져오세요. 최초 로그인 시 로컬 기록이 클라우드에 옮겨집니다.

휴대폰과 컴퓨터에서 같은 계정으로 로그인하면 같은 기록을 볼 수 있습니다. 계정 이메일 가입 확인이 켜져 있으면 확인 이메일 링크를 누른 뒤 로그인하세요. Supabase 기본 이메일 발송은 시험용 제한이 있을 수 있어, 실제로 지속 사용할 때는 자체 SMTP 설정이 필요할 수 있습니다.

## 기록 저장 동작

- 로그인하지 않은 동안에는 현재 기기에만 저장합니다.
- 처음 로그인하고 계정에 클라우드 기록이 없으면 이 브라우저 기록을 클라우드에 올립니다.
- 계정에 이미 기록이 있으면 클라우드 기록이 현재 브라우저 기록을 대체합니다.
- 백업 가져오기는 현재 기록과 백업 내용을 날짜·끼니 키 기준으로 합칩니다. 같은 키가 양쪽에 있으면 가져온 백업 쪽이 우선합니다.
- 동기화에는 인터넷 연결이 필요합니다. JSON 내보내기로 계속 백업해 두세요.
