# Sample: Multiple Agents, Multiple Toolkits

This sample shows **multiple agents**, **multiple toolkits**, and **agents that use a mix of toolkits** via `Toolkit.merge` and `Layer.merge`.

## Toolkits

| Toolkit              | Tools                                                                |
| -------------------- | -------------------------------------------------------------------- |
| **CustomerTools**    | `getResturant` – look up a restaurant by name                        |
| **ReservationTools** | `createReservation`, `listReservations` – book and list reservations |
| **MenuTools**        | `getMenu`, `getMenuItem` – get menu and item details                 |

## Agents (mix of toolkits)

| Agent            | Toolkits used                 | Use case                                      |
| ---------------- | ----------------------------- | --------------------------------------------- |
| **restaurant**   | Customer + Menu               | Find a restaurant and explore its menu        |
| **reservations** | Customer + Reservation        | Find a restaurant and make/list reservations  |
| **concierge**    | Customer + Reservation + Menu | Full capability: find, menu, and reservations |

## Pattern: merging toolkits per agent

Each agent composes toolkits with `Toolkit.merge` and merges their layers with `Layer.merge`:

```ts
// One toolkit per concern
const restaurantToolkit = Toolkit.merge(customerToolkit, menuToolkit);
const restaurantToolkitLayer = Layer.merge(customerToolkitLayer, menuToolkitLayer) as Layer.Layer<
  unknown,
  unknown,
  unknown
>;

export const restaurantAgent: AgentSpec = {
  name: "Restaurant Agent",
  buildPrompt: (ctx) => "...",
  toolkit: restaurantToolkit,
  toolkitLayer: restaurantToolkitLayer,
};
```

## Run the examples

**Production-grade (recommended):** Single concierge agent with full toolset:

```bash
OPENAI_API_KEY=sk-... npx tsx examples/voice-concierge.ts
```

**Concierge (sample agents):** Uses concierge agent from this sample:

```bash
OPENAI_API_KEY=sk-... npx tsx examples/concierge.openai.ts
# or:
GEMINI_API_KEY=... npx tsx examples/concierge.gemini.ts
```

Then open `http://localhost:8081`.
