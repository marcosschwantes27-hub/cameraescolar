# Registro Escolar

Base do Sistema de Atendimento e Ocorrências Escolares.

## O que já existe

- busca manual por nome, matrícula ou turma;
- seleção do aluno;
- registro de atraso, saída antecipada, registro escolar, ata e advertência;
- campos dinâmicos por tipo de ocorrência;
- seleção local de anexo para o contrato futuro de upload;
- histórico recente do aluno;
- contratos TypeScript e adaptador substituível;
- API FastAPI integrada ao frontend;
- PostgreSQL direto, sem Supabase;
- isolamento das consultas por escola;
- migrações Alembic e trilha de auditoria;
- endpoints para alunos e ocorrências.

O frontend usa a API real. Busca, criação de ocorrência e histórico são persistidos no
PostgreSQL. Nesta versão local a tela de login está desativada; os componentes de autenticação
ficaram reservados para uma etapa futura.

## Arquitetura

```text
React/TypeScript
  -> SchoolOperations (contrato frontend)
  -> cliente HTTP
  -> FastAPI
  -> SQLAlchemy + Alembic
  -> PostgreSQL
```

O projeto não usa Supabase. O navegador nunca acessa o PostgreSQL diretamente: a API faz
validação, auditoria e persistência. A autenticação está desativada somente no modo local.

## Frontend

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
```

## Backend local

Pré-requisitos: Python 3.13, `uv`, Docker e Docker Compose.

1. Copie `.env.example` para `.env` e troque as senhas e a chave JWT.
2. Instale as dependências e inicie o PostgreSQL:

```powershell
uv sync --project backend
docker compose up -d --wait postgres
```

3. Aplique as migrações:

```powershell
uv run --project backend alembic -c backend/alembic.ini upgrade head
```

4. Execute a API:

```powershell
uv run --project backend uvicorn app.main:app --reload --app-dir backend
```

A documentação interativa fica em `http://127.0.0.1:8000/docs`.
Na primeira inicialização local, o sistema cria somente a escola, o usuário técnico e três
turmas. Nenhum aluno, rosto ou registro é criado automaticamente. Os cadastros feitos pela tela
são reais e permanecem após atualizar a página.

5. Em outro terminal, execute o frontend:

```powershell
npm run dev
```

A interface fica em `http://127.0.0.1:4173`.

## Preparar em outro computador

O banco PostgreSQL não precisa ser enviado pelo GitHub. Cada computador cria seu próprio banco
local no volume do Docker e a API prepara a estrutura vazia na primeira execução.

```powershell
git clone URL_DO_REPOSITORIO
cd cameraescolar
Copy-Item .env.example .env
npm ci
uv sync --project backend
docker compose up -d --wait postgres
uv run --project backend alembic -c backend/alembic.ini upgrade head
```

Depois, execute a API e o frontend em dois terminais:

```powershell
uv run --project backend uvicorn app.main:app --app-dir backend --port 8000
npm run dev
```

O `.env`, o banco, os alunos e as biometrias nunca devem ser enviados ao GitHub. Os modelos
YuNet e SFace fazem parte do repositório e funcionam localmente, sem baixar serviços externos.

## Endpoints implementados

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/students?q=...`
- `POST /api/v1/students`
- `POST /api/v1/student-face-enrollments`
- `GET /api/v1/students/{id}`
- `GET /api/v1/students/{id}/occurrences`
- `POST /api/v1/students/{id}/occurrences`
- `POST /api/v1/students/{id}/face-enrollment`
- `POST /api/v1/recognition/identify`
- `GET /health/live` e `GET /health/ready`

## Verificação

Com o PostgreSQL iniciado:

```powershell
uv run --project backend pytest backend/tests
uv run --project backend ruff check backend
uv run --project backend mypy backend/app backend/tests
uv run --project backend alembic -c backend/alembic.ini check
```

O cadastro facial guiado captura três imagens em cinco posições, valida enquadramento, iluminação,
nitidez, consistência e diversidade de pose, e armazena as duas melhores biometrias SFace de cada
posição. Para um aluno novo, dados e biometria são gravados na mesma transação. Antes de salvar, a
API compara vários frames com os alunos da mesma escola e interrompe possíveis duplicidades para
revisão humana. O reconhecimento usa vários frames e mantém a confirmação humana obrigatória.
Prova de vida resistente a ataques, rate limiting, política de backup, monitoramento e revisão de
LGPD ainda são requisitos anteriores à produção.

## Referência visual

O frontend usa como referência o documento `DESIGN-notion.md` enviado pelo usuário. As decisões
principais ficaram registradas em `docs/frontend-design-reference.md`:
canvas quente, cartões brancos, tipografia Inter, azul como única cor estrutural, hairlines e
sombras discretas. O documento é referência visual, não uma especificação funcional.
