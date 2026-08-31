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
- PostgreSQL via API FastAPI, com suporte a Supabase;
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

O navegador nunca acessa o PostgreSQL diretamente: a API faz validação, auditoria e
persistência. O Supabase hospeda somente o PostgreSQL; a senha e demais segredos ficam no
ambiente da API. A autenticação está desativada somente no modo local.

## Frontend

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
```

## Executar sem Docker usando Supabase

Pré-requisitos: projeto Supabase, Python 3.13, `uv` e Node.js. O `uv` pode instalar o Python
3.13 quando ele não estiver disponível.

1. Copie `.env.example` para `.env`. No Supabase, abra **Connect** e copie a URL de conexão. Para
   uma API persistente, prefira a conexão direta; em rede apenas IPv4, use o **Shared pooler / Session mode**.
   Troque `postgresql://` por `postgresql+psycopg://`, preserve `?sslmode=require` e defina uma
   chave JWT aleatória com pelo menos 32 caracteres.
2. Instale as dependências, aplique as migrações e execute a API:

```powershell
uv sync --project backend
uv run --project backend alembic -c backend/alembic.ini upgrade head
uv run --project backend uvicorn app.main:app --reload --app-dir backend --port 8000
```

A documentação interativa fica em `http://127.0.0.1:8000/docs`.
Na primeira inicialização local, o sistema cria somente a escola, o usuário técnico e três
turmas. Nenhum aluno, rosto ou registro é criado automaticamente. Os cadastros feitos pela tela
são reais e permanecem após atualizar a página.

3. Em outro terminal, execute o frontend:

```powershell
npm run dev
```

A interface fica em `http://127.0.0.1:4173`.

O arquivo `.env` é ignorado pelo Git. Nunca cole nele valores reais em arquivos versionados, em
prompts ou em ferramentas de importação.

## Frontend no Google AI Studio

O AI Studio pode remodelar o frontend, mas a API FastAPI precisa estar em uma URL HTTPS pública
para que um frontend remoto acesse o banco indiretamente. O Supabase substitui apenas o PostgreSQL
local; ele não hospeda esta API automaticamente.

1. Implante a pasta `backend` em um serviço que execute Python e configure nesse serviço as
   variáveis `REGISTRO_*` reais.
2. Execute `alembic upgrade head` uma vez usando a conexão direta do Supabase.
3. Defina `VITE_API_BASE_URL` com a URL HTTPS pública da API no ambiente de build do frontend.
4. Adicione a origem HTTPS publicada pelo AI Studio a `REGISTRO_CORS_ALLOWED_ORIGINS` e faça novo
   deploy da API. Mantenha apenas origens explícitas.

Veja a lista de verificação em [docs/google-ai-studio-import.md](docs/google-ai-studio-import.md).

## Alternativa: PostgreSQL local com Docker

O Docker continua como alternativa para desenvolvimento local. Defina no `.env` as variáveis
`REGISTRO_POSTGRES_DB`, `REGISTRO_POSTGRES_USER`, `REGISTRO_POSTGRES_PASSWORD` e
`REGISTRO_POSTGRES_PORT`, troque `REGISTRO_DATABASE_URL` pela URL local e inicie o serviço:

```powershell
docker compose up -d --wait postgres
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
