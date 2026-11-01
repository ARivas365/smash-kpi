# Formato JSON de ataques por partida (para el mod de PC)

La app importa este archivo desde **Ajustes → Importar → Elegir archivo JSON**. Reconoce el tipo de archivo por el campo `format`.

```json
{
  "format": "smash-kpi-attacks",
  "version": 1,
  "source": "mod-pc",
  "matches": [
    {
      "gameId": null,
      "startedAt": "2026-11-01T21:10:00-03:00",
      "endedAt": "2026-11-01T21:14:30-03:00",
      "myChar": "Cloud",
      "oppChar": "Pikachu",
      "stage": "Battlefield",
      "attacks": {
        "me":  { "jab": 6, "ftilt": 3, "nair": 9, "fair": 7, "up_b": 2 },
        "opp": { "jab": 4, "nair": 8, "neutral_b": 10 }
      }
    }
  ]
}
```

## Campos

| Campo | Obligatorio | Descripción |
|---|---|---|
| `format` | sí | Siempre `"smash-kpi-attacks"`. |
| `version` | sí | `1`. |
| `source` | no | Texto libre que identifica quién generó el archivo. |
| `matches[]` | sí | Una entrada por game. |
| `gameId` | no | `id` del game en la app (se ve en el respaldo JSON). Si está, se usa para asociarlo directamente. |
| `startedAt` / `endedAt` | sí, si no hay `gameId` | Fecha y hora ISO 8601 con zona horaria. Se prefiere `endedAt`. |
| `myChar` / `oppChar` | recomendado | Mismos nombres que usa la app (ver `js/data.js`, por ejemplo `"Pyra/Mythra"` o `"R.O.B."`). |
| `stage` | no | Informativo. |
| `attacks.me` / `attacks.opp` | sí | Objeto `{ nombre_del_ataque: cantidad }`. |

### Nombres de ataques sugeridos
`jab, ftilt, utilt, dtilt, dash_attack, fsmash, usmash, dsmash, nair, fair, bair, uair, dair, grab, pummel, fthrow, bthrow, uthrow, dthrow, neutral_b, side_b, up_b, down_b, getup_attack, ledge_attack`

Se acepta cualquier clave: la app guarda lo que venga.

## Cómo se asocia cada partida a un game

1. Si tiene `gameId` y existe ese game, se asocia a ese.
2. Si no, busca el game cargado más cercano en el tiempo a `endedAt` (o `startedAt`), dentro de **±25 minutos**, con el mismo `myChar` y `oppChar` (si vienen en el archivo).
3. Si no encuentra ninguno, la partida queda **pendiente** y se asocia sola cuando cargues un game que coincida.

Los ataques asociados se ven en **Historial** (los 5 más usados) y se incluyen en el respaldo JSON.
