# PromptVault AI

Gestor de prompts de inteligencia artificial con extracción automática de metadata mediante IA.

![PromptVault](https://img.shields.io/badge/PromptVault-AI-00d4ff?style=for-the-badge&labelColor=0a0a0f)

---

## Características

- **Gestión de Prompts**: Crea, edita, organiza y busca prompts en un solo lugar.
- **Extracción Automática con IA**: Analiza el contenido de tus prompts y extrae automáticamente tipo, subtipo, etiquetas y descripción usando OpenRouter.
- **Flujos de Trabajo (Workflows)**: Crea cadenas de prompts reutilizables que puedes ejecutar en secuencia.
- **Categorización Inteligente**: Filtra por tipo (imagen, video, código, texto) y subtipos personalizados.
- **Sistema de Favoritos**: Marca prompts importantes para acceso rápido.
- **Soporte de Imágenes**: Adjunta imágenes de referencia a cada prompt.
- **Importación/Exportación**: Migra tus datos en formato JSON.
- **Interfaz Oscura**: Diseño moderno y optimizado para lectura en entornos oscuros.
- **Responsive**: Funciona en escritorio y móvil.

---

## Stack Tecnológico

| Capa       | Tecnología                          |
|------------|-------------------------------------|
| Frontend   | HTML5, Tailwind CSS, JavaScript ES6 |
| Backend    | Node.js, Express.js                 |
| Base de datos | PostgreSQL (Railway)              |
| API de IA  | OpenRouter (modelos LLM)           |
| Deploy     | Railway                             |

---

## Requisitos

- Node.js >= 18.0.0
- PostgreSQL (proporcionado automáticamente por Railway)
- API key de OpenRouter (opcional, solo para extracción con IA)

---

## Instalación Local

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/promptvault.git
cd promptvault

# Instalar dependencias
npm install

# Crear base de datos PostgreSQL local o usar una URL de conexión
# Establecer la variable de entorno
export DATABASE_URL="postgresql://usuario:contraseña@localhost:5432/promptvault"

# Iniciar el servidor
npm start
```

El servidor escuchará en `http://localhost:3000`.

---

## Variables de Entorno

| Variable       | Descripción                                      | Requerido |
|----------------|--------------------------------------------------|-----------|
| `DATABASE_URL` | URL de conexión a PostgreSQL                     | Sí        |
| `PORT`         | Puerto del servidor ( Railway lo establece)       | No        |

> **Nota**: La API key de OpenRouter se guarda en el navegador del usuario (localStorage) y nunca se envía al servidor.

---

## API REST

### Prompts

| Método | Ruta                     | Descripción                         |
|--------|--------------------------|-------------------------------------|
| GET    | `/api/prompts`           | Listar prompts (paginado)          |
| POST   | `/api/prompts`           | Crear/actualizar prompt (upsert)    |
| POST   | `/api/prompts/bulk`      | Importación masiva                  |
| PUT    | `/api/prompts/:id`       | Actualizar prompt completo          |
| PATCH  | `/api/prompts/:id/favorite` | Alternar favorito               |
| PATCH  | `/api/prompts/:id/use`   | Incrementar contador de uso        |
| DELETE | `/api/prompts/:id`       | Eliminar prompt                    |

### Workflows

| Método | Ruta                              | Descripción                    |
|--------|-----------------------------------|--------------------------------|
| GET    | `/api/workflows`                  | Listar todos los workflows     |
| POST   | `/api/workflows`                  | Crear workflow                 |
| GET    | `/api/workflows/:id`              | Ver workflow con sus nodos     |
| PUT    | `/api/workflows/:id`              | Actualizar nombre/descripción  |
| DELETE | `/api/workflows/:id`             | Eliminar workflow              |
| PATCH  | `/api/workflows/:id/nodes`       | Añadir/remover/reordenar nodos |
| GET    | `/api/workflows/prompt/:promptId` | Ver workflows de un prompt    |

---

## Modelo de Datos

### Prompts

```sql
id          TEXT PRIMARY KEY
title       TEXT
description TEXT
content     TEXT NOT NULL
type        TEXT DEFAULT 'uncategorized'  -- image, video, code, text, uncategorized
subtype     TEXT DEFAULT 'other'
tags        JSONB DEFAULT '[]'
confidence  REAL DEFAULT 0.5
attributes  JSONB DEFAULT '{}'
favorite    BOOLEAN DEFAULT FALSE
image       TEXT
created     TIMESTAMPTZ DEFAULT NOW()
updated     TIMESTAMPTZ DEFAULT NOW()
usage_count INTEGER DEFAULT 0
```

### Workflows

```sql
-- Tabla principal
id          TEXT PRIMARY KEY
name        TEXT NOT NULL
description TEXT
created     TIMESTAMPTZ DEFAULT NOW()
updated     TIMESTAMPTZ DEFAULT NOW()

-- Nodos (prompts dentro de un workflow)
workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE
prompt_id   TEXT REFERENCES prompts(id) ON DELETE CASCADE
position    INTEGER NOT NULL DEFAULT 0
PRIMARY KEY (workflow_id, prompt_id)
```

---

## Despliegue en Railway

### 1. Subir a GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/TU_USUARIO/promptvault.git
git push -u origin main
```

### 2. Crear proyecto en Railway

1. Ve a [railway.app](https://railway.app) → **New Project**
2. Selecciona **Deploy from GitHub repo** → elige tu repositorio

### 3. Agregar PostgreSQL

1. En tu proyecto → **+ New** → **Database** → **Add PostgreSQL**
2. Railway configura `DATABASE_URL` automáticamente

### 4. Deploy

Railway hace deploy automático en cada push. También puedes forzar un deploy desde el dashboard.

### 5. Listo

La tabla `prompts` se crea automáticamente al primer arranque.

---

## Migración desde Versión Local (localStorage)

Si tienes datos guardados en el navegador:

1. Abre la versión antigua → **Exportar** → Copia el JSON
2. En la nueva versión → **Importar** → Pega el JSON → Importar

---

## Scripts Disponibles

```bash
npm start    # Iniciar servidor en producción
npm run dev  # Iniciar con --watch (recarga en cambios)
```

---

## Licencia

MIT