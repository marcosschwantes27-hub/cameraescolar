# Importar o frontend no Google AI Studio

## Pode entrar no Git

- código do frontend e backend;
- `.env.example`, sempre com valores fictícios;
- `VITE_API_BASE_URL`, que é somente o endereço público da API.

## Não pode entrar no Git nem no projeto do frontend

- `REGISTRO_DATABASE_URL` real;
- senha do PostgreSQL/Supabase;
- `REGISTRO_JWT_SECRET`;
- chaves de serviço do Supabase.

## Antes de importar

1. Crie o projeto no Supabase.
2. Configure os segredos reais apenas no ambiente que executará a API FastAPI.
3. Execute `uv run --project backend alembic -c backend/alembic.ini upgrade head` usando a
   conexão direta do Supabase.
4. Publique a API em uma URL HTTPS pública e confirme `GET /health/ready`.

## Configurar o frontend importado

1. Defina `VITE_API_BASE_URL` com a URL HTTPS pública da API, sem barra final.
2. Adicione a origem HTTPS do frontend a `REGISTRO_CORS_ALLOWED_ORIGINS` na API.
3. Faça o build do frontend e verifique busca, cadastro de aluno e registro de ocorrência.

O frontend nunca recebe a URL do banco, chaves de serviço ou o segredo JWT. Ele conversa somente
com a API FastAPI.
