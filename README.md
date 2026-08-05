# Common Ground

A small shared 3D survival world for three browser-local language-model agents and one human player. This is a concept reset from the repository's earlier 2D genetic simulation; its history and legacy sources remain available, but the application now starts from a simpler, observable world where rules can be added deliberately.

## Current prototype

- A procedural low-poly valley rendered with Three.js, including terrain, atmosphere, shadows, resources, characters, and built structures.
- Three autonomous agents and one human-controlled character. The initial population is four and the hard cap is six.
- One shared [`SmolLM2-135M-Instruct`](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct) model, loaded in the browser through Transformers.js using 4-bit weights. It uses WebGPU when available and WASM otherwise.
- The model receives compact local observations and chooses from a short menu of valid, context-specific actions. The simulation owns all state changes. Agents use deterministic survival instincts while the model downloads or if its response is invalid.
- Communication with short-term memories, gathering berries and wood, mining stone, combat, mutual reproduction, crafting, and construction.
- Crafting recipes for a pickaxe, sword, shelter kit, and cooked meal.
- A world log and inspectable intentions, thoughts, inventories, health, and energy.

The language model is shared rather than copied per character. Agent requests are serialized, keeping memory use low and the scene responsive. Model files are cached by the browser after the first download.

## Play

```bash
npm install
npm run dev
```

- `WASD` or arrow keys: move your character
- `E`: gather, mine, or greet the closest nearby entity
- Mouse drag/wheel: orbit and zoom the camera
- Click an agent: inspect, talk, propose reproduction, or fight
- Bottom dock: eat, craft, and build
- Chat field: speak to all agents within hearing range
- Space: pause/resume

Reproduction is deliberately consensual: both nearby characters must independently request it while healthy enough. A request from only one side never creates a child.

## Rules and safety boundary

The LLM never mutates the world directly. The engine offers it context-specific choices drawn from:

`move`, `say`, `pickup`, `dig`, `craft`, `build`, `attack`, `reproduce`, or `rest`.

IDs, distance, ingredients, energy, capacity, and action shape are checked by `WorldEngine`. Constraining a 135M-parameter model to select a valid action is much more reliable than asking it to generate arbitrary JSON, while its decision still controls what the character does.

## Verification

```bash
npm run build
npm run test:sandbox
```

The focused test covers the four-character setup, player gathering, crafting, communication, mutual reproduction, and rejection of unknown model actions.

## Suggested next experiments

1. Give agents persistent autobiographical summaries stored in IndexedDB.
2. Add explicit promises and reputation, then compare resource sharing with and without remembered identity.
3. Add player-authored rules as validated world modifiers.
4. Add a cooperation assay: a two-person construction that no individual can finish alone, with survival statistics across repeated worlds.
5. Move model inference to a Web Worker so long generations never compete with rendering.
