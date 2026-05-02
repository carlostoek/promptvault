# PromptVault: Intención + Búsqueda Inteligente + UI Redesenhada

**Fecha:** 2026-05-02
**Status:** Aprobado

---

## 1. Resumen

Agregar extracción de **intención/propósito** en metadata de prompts de imagen, implementar búsqueda inteligente con sugerencias basadas en metadatos, y rediseñar la interfaz de búsqueda para una experiencia más moderna y fluida.

---

## 2. Nuevo Campo: `intention` en `attributes.image`

### 2.1 Valores permitidos

| Valor | Descripción | Ejemplo |
|-------|-------------|---------|
| `create` | Generar algo desde cero | "Create a portrait of..." |
| `modify` | Cambiar aspectos de imagen existente | "Add glasses to..." |
| `improve` | Enhance, polish, refine | "Make it sharper..." |
| `restyle` | Aplicar nuevo aesthetic/estilo | "Give it vintage look..." |
| `restore` | Reparar, aging, deterioro | "Make it look old..." |
| `adapt` | Cambiar formato/proporción | "Convert to 16:9..." |

### 2.2 Ubicación en schema

El campo se almacena en `attributes.image.intention`, siguiendo el mismo patrón que `camera_angle`, `lighting_source`, etc.

### 2.3 Extracción por IA

El system prompt se actualiza para incluir `intention` como campo obligatorio con ejemplos.

---

## 3. System Prompt Mejorado

### 3.1 Cambios en el prompt de extracción

**Añadir en `attributes.image`:**

```json
"intention": "create | modify | improve | restyle | restore | adapt",
"intention_confidence": 0.9
```

**Añadir ejemplos después de la estructura JSON:**

```
INTENTION EXAMPLES:
- "Create a cinematic portrait of a woman" → intention: "create"
- "Add a sunset background to this photo" → intention: "modify"
- "Enhance the lighting and reduce noise" → intention: "improve"
- "Give this image a cyberpunk neon aesthetic" → intention: "restyle"
- "Make this photo look like it was taken in 1950" → intention: "restore"
- "Convert this to a square format for Instagram" → intention: "adapt"

IMPORTANT: The "intention" field is mandatory. Analyze what the user wants to ACCOMPLISH with this prompt, not just the content. If ambiguous, infer from context words like "add", "make it", "convert", "enhance", "create new", "style", "age".
```

### 3.2 Validación

- Si `intention` no puede determinarse, usar `null` (no bloquea extracción)
- `intention_confidence` refleja certeza del modelo sobre la clasificación

---

## 4. Búsqueda Inteligente (Server-side)

### 4.1 Nuevo endpoint

**`GET /api/prompts/suggest?q=<texto>`**

Parámetros:
- `q` (requerido): texto de búsqueda
- `limit` (opcional, default 6): número de sugerencias

### 4.2 Algoritmo de scoring

Búsqueda multi-campo con pesos:

| Campo | Peso | Descripción |
|-------|------|-------------|
| `attributes.image.intention` | 3x | Match de intención = alta relevancia |
| `type` + `subtype` | 2x | Categoría similar |
| `tags` | 2x | Tags en común |
| `title` + `description` | 1x | Coincidencia textual |
| `content` | 0.5x | Búsqueda en contenido |

### 4.3 Lógica de búsqueda

1. Parsear query para detectar intención (palabras clave: "crear", "mejorar", "modificar", "hacer vieja", "cambiar estilo", etc.)
2. Si se detecta intención, boostear ese campo en scoring
3. Si no, búsqueda general por texto en todos campos
4. Devolver top 6 resultados ordenados por score

### 4.4 Response

```json
{
  "suggestions": [
    {
      "id": "prompt_123",
      "title": "...",
      "description": "...",
      "type": "image",
      "intention": "restore",
      "score": 0.85,
      "reason": "intention_match"
    }
  ]
}
```

### 4.5 Sugerencias específicas por intención

Mapeo de queries comunes a intención:

| Query keywords | Intención |
|----------------|-----------|
| "crear", "generar", "nuevo" | `create` |
| "modificar", "cambiar", "añadir", "quitar" | `modify` |
| "mejorar", "enhance", "refinar" | `improve` |
| "estilo", "aesthetic", "vintage", "cyberpunk" | `restyle` |
| "vieja", "aging", "deteriorar", "restore" | `restore` |
| "adaptar", "convertir", "formato", "resize" | `adapt` |

---

## 5. Rediseño UI de Búsqueda

### 5.1 Search bar mejorada

**Antes:** Input simple con borde oscuro
**Después:**
- Padding expandido al focus (efecto glow sutil cyan)
- Ícono de búsqueda animado (lupa que gira al escribir)
- Placeholder dinámico: "Buscar por intención, tags, contenido..."
- Border con gradiente sutil al focus

### 5.2 Filtros atómicos colapsables

**Antes:** 4 selects visibles ocupando espacio
**Después:**
- Botón "Filtros avanzados ▼" que expande accordion
- Por defecto colapsado para ahorrar espacio
- Dentro del accordion: dropdowns organizados en grid 2x2
- Indicador visual cuando hay filtros activos (badge con count)

### 5.3 Pills de intención

Nuevos filtros rápidos junto a categorías:

```
[Todos] [Favoritos] [Imagen] [Video] [Código] [Otros]
[+ Crear] [+ Modificar] [+ Mejorar] [+ Estilo] [+ Restaurar]
```

Cada pill es clickeable y actúa como filtro adicional (AND con categoría).

### 5.4 Sugerencias en tiempo real

**Comportamiento:**
- Debounce de 300ms antes de buscar
- Dropdown de sugerencias aparece debajo del search
- Máximo 4 sugerencias visibles
- Cada sugerencia muestra: título + intención badge + match reason
- Click en sugerencia navega al prompt
- Tecla ESC cierra dropdown

### 5.5 Cards de prompts mejoradas

**Cambios visuales:**
- Borde más suave (border-radius: 16px → 20px)
- Sombra más difusa y sutil
- Preview del contenido truncado a 2 líneas
- Badge de intención visible (coloreado por tipo)
- Tags visibles sin hover
- Hover state con elevación sutil (translateY -2px)

**Layout:**
```
┌─────────────────────────────────────┐
│ [Intención Badge]     [Tipo] [Tags] │
│ Título del Prompt                  │
│ Descripción corta...                │
│ ─────────────────────────────────── │
│ 📝 2 lines preview...    [★] [→]  │
└─────────────────────────────────────┘
```

### 5.6 Colores de intención

| Intención | Color |
|-----------|-------|
| `create` | Emerald (#10b981) |
| `modify` | Amber (#f59e0b) |
| `improve` | Cyan (#06b6d4) |
| `restyle` | Purple (#a855f7) |
| `restore` | Orange (#f97316) |
| `adapt` | Pink (#ec4899) |

---

## 6. Cambios en Frontend

### 6.1 Estados de búsqueda

1. **Idle**: Search bar normal, sin sugerencias
2. **Typing**: Con sugerencias visibles debajo
3. **Loading**: Spinner inline en search bar
4. **Results**: Lista de prompts filtrados

### 6.2 Filtros activos

Los filtros activos se muestran como chips removibles:

```
[Filtros activos]
[× Ángulo: Low Angle] [× Hora: Golden Hour]

Borra todos los filtros
```

### 6.3 Empty state mejorado

Cuando búsqueda no devuelve resultados:
- Mensaje contextual: "No hay prompts para 'texto buscado'"
- Sugerencias: "Prueba con intención diferente o busca por tags"

---

## 7. Compatibilidad

- Prompts existentes sin `intention` muestran `null` en UI
- Búsqueda funciona con y sin intención en metadata
- No requiere migración de DB (solo extensión de JSONB)
- Filters existentes mantienen backwards compatibility

---

## 8. Implementación steps

1. Actualizar system prompt para extraer `intention`
2. Actualizar frontend para mostrar badge de intención
3. Crear endpoint `/api/prompts/suggest`
4. Implementar dropdown de sugerencias en search
5. Rediseñar filtros como accordion colapsable
6. Agregar pills de intención como filtros rápidos
7. Mejorar cards con nuevos estilos

---

## 9. Archivos a modificar

- `server.js` — endpoint `/api/prompts/suggest`
- `public/index.html` — system prompt + UI completa