// LegacyBot v0.36 — Pyramid bottom-up optimizer for 10 essentials.
//
// What's new vs v0.35:
//   AAA. buildCatalog now captures `provide` effects (e.type === 'provide')
//        into c.provides[res] = amount. Foundation for capacity-cap detection.
//   BBB. Bot.producerMap inverts the catalog: resName → [{unit, mode, rate, kind}]
//        where kind is 'flow' (gather/convert output), 'capacity' (unit provide),
//        or 'capacity-tech' (tech provide res effect).
//   CCC. Bot.essentialChains is built once on start() for each of the 10
//        ESSENTIALS (population, workers, insight, wisdom, culture, faith,
//        influence, happiness, health, land). Each chain has capProviders
//        (who raises the cap), flowProducers (who produces the per-tick rate),
//        and recursively-walked requires[] for each producer.
//   DDD. Bot.findBottleneck(essentialName) walks the chain breadth-first:
//        cap-saturated essential → first un-built capProvider;
//        for each flowProducer: mode-not-active → resource demand boost;
//        producer-input saturated → recurse into requirements.
//        Returns {essential, resource, kind, severity}.
//   EEE. computeDemandForModes now adds a final pass that boosts the demand
//        weight (×10) for every essential's current bottleneck. The existing
//        mode picker / distribute / building-mode picker naturally favor
//        the bottleneck without any new pinning or target restructuring.
//   FFF. computeTier3Production now consults Bot._bottleneckProducers — when
//        a bottleneck resolves to a `convert`-mode producer (like artisan/
//        Craftwands for Wand), that unit name gets 1.5× weight in the equal-
//        share allocation. Demand boost alone is insufficient if all instances
//        are already in the right mode.
//   GGG. Hidden cap resources (wisdom / inspiration / spirituality / authority)
//        are unhidden on start() so the user can see them in the game's
//        own resource sidebar alongside the visible essentials.
//   HHH. UI gains an "Essential Pyramids" section: 10 rows, one per essential,
//        with current/cap, gain/loss net, and bottleneck (red) if any. Each
//        row expands on click to show the ASCII pyramid with bottleneck row
//        highlighted.
//
// What's new vs v0.34:
//   YY. The single-mode firekeeper override was fighting the multi-instance
//       distribute. distribute would split firekeepers across stick/cook/cure,
//       then assignFirekeeperModes would force ALL of them back to one mode
//       (whatever preferredMode currently was), with stamps not aligning,
//       triggering the user-touched flag the next tick.
//   ZZ. Now: if more than one firekeeper instance has a non-zero amount with
//       a different mode (i.e. distribute already split them), the override
//       does nothing. The override only acts when there's exactly one mode
//       across all firekeepers — the single-instance fallback path.
//
// What's new vs v0.33:
//   XX. Bot.release(name) now also re-stamps every instance of that unit with
//       its current signature. Previously the bot would release the name from
//       _userControlled, but the per-instance signatures still showed deviation,
//       so the next tick's isHandsOff re-added the name and re-locked it.
//       Now: release is real — the bot accepts the current state as its new
//       baseline and resumes management.
//
// What's new vs v0.32:
//   UU. Bot.createUI() builds a draggable, collapsible panel in the top-right
//       of the game. Shows: pop/workers/happiness/health/food/water with net
//       trends, toggles for every auto-feature, pinned units (with unpin),
//       user-controlled units (with release), and recent regressions.
//   VV. Auto-refreshes every 1.5s. Toggles are live — uncheck autoBuy and
//       the bot stops buying immediately, etc.
//   WW. ⏸/▶ button in the header stops/starts the bot; − collapses to title-only.
//
// What v0.32 brought (still here):
//
// What's new vs v0.31:
//   QQ. Every time the bot writes (targetAmount or mode) to an instance, it
//       stamps the instance with a signature `_botSig = "targetAmount|modeId"`.
//   RR. Before every subsequent write, the bot computes the current signature
//       and compares to the stored one. If different, the user touched it —
//       the whole unit NAME goes into _userControlled and the bot leaves it
//       alone until LegacyBot.release(name) is called.
//   SS. This replaces the buggy "compare totalQueued to lastBotTarget" check
//       which kept catching the bot's own rounding/distribute changes as
//       user input. Per-instance is precise: only actual deviation from
//       the bot's exact last write counts.
//   TT. On start() or restart, every existing instance gets stamped with
//       its current state — so existing world becomes the baseline.
//
// PHILOSOPHY: the bot is a layer that runs UNDER the user's work. It balances
// resources and production so the civilization stays healthy, but it never
// fights the user. The user controls speed; the bot adapts. The user can
// manually queue, build, or pause anything and the bot won't undo it (pin if
// you want hard guarantees).
//
// What's new vs v0.30:
//   OO. autoSpeed default false — bot never touches `fast` or `paused`.
//   PP. doSpeedTick is a no-op (kept for backward compat). Speed timer is
//       not started in start().
//
// What's new vs v0.25:
//   II. foodOutputPerWorker raised from 2.5 → 12 (matches real measured rate).
//       At pop 96k v0.25 was demanding 38k food workers; v0.30 only needs ~6k.
//   JJ. foodPerCapitaEat 1.0 → 0.7 (not everyone eats every tick at plentiful).
//   KK. foodQuotaFrac 0.30 → 0.03 — pop-fraction is no longer the dominant
//       cap; consumption-driven math is.
//   LL. Food-safety bonus is now an ABSOLUTE 50-200 worker buffer, not 10% pop.
//       v0.25 added pop × 0.1 = 9k extra workers "just in case", which destroyed
//       any chance of a meaningful tier-3 production budget.
//   MM. New computeTier3Production: distributes the full remaining worker
//       budget across all eligible producing units, capped at pop × 0.03 per
//       unit. Result: 8 unit types × ~3k workers each = 24k workers absorbed.
//   NN. _userControlled auto-flagging REMOVED. Only explicit pin() locks units;
//       the prior heuristic kept re-adding units to the locked set every tick.
//
// What v0.25 brought (still here):
//
// What's new vs v0.23:
//   GG. distribute uses sum(amount) — NOT sum(max(amount,target)) — as the
//       base for redistribution. v0.23 fed targets back into itself each tick,
//       which on auto-scheduled calls caused exponential growth: blacksmith
//       went from target=1099 → 138 MILLION across a few ticks.
//   HH. Pop-driven growth now happens ONLY via the building auto-target list
//       (in doBuyTick), keeping the two systems orthogonal.
//
// What's new vs v0.21:
//   DD. distributeMultiInstanceModes now handles BUILDINGS as well as workers.
//       Mines split across coal/salt/copper/tin/iron/gold/lead/any. Furnaces
//       across iron/gold/mythril/osmium/lead/zinc/copper/tin. Blacksmiths
//       across metal tools/hard tools/gold blocks/mythril/weapons/armor.
//       Kilns: bricks + glass. Quarries: regular + advanced + for-ores.
//   EE. isHandsOff is _multiInstanceHandled-aware AND tolerates +-10 deviation
//       in totalQueued (previously every off-by-one rounding flagged units
//       as user-controlled, which then locked the bot out of managing them).
//   FF. Building auto-target list skips units in _multiInstanceHandled so the
//       two competing target sources (auto-list vs distribute) don't oscillate.
//
// What v0.21 brought (still here):
//
// What's new vs v0.18:
//   Z. Found G.splitUnit(instance, 1) — creates a new empty instance of any
//      unit type. With this, the bot can run multiple modes of the SAME unit
//      type in parallel. v0.18 had artisans only knapping (one mode for all),
//      so wands, dyes, bows, baskets, books — all unproduced.
//   AA. Bot.distributeMultiInstanceModes() now runs every doModeTick:
//       1. For each multi-mode unit, list reqs-met modes that produce something.
//       2. Score each by demand × output, with a 50x diversity bonus for modes
//          producing unique-to-themselves resources, and floor of 1.
//       3. Auto-split until instances ≥ min(useful modes, maxModesPerUnit=8).
//       4. Top mode gets 40% workers; rest split by score with floor=5.
//       5. Record actual-sum into _botSetTargets so next tick doesn't see deviation.
//   BB. manageBuildingModes rewritten: forces ON every multi-mode building
//       (was leaving kiln/quarry/mine/blacksmith/furnace all in 'off' mode).
//   CC. v0.18's auto-targeted buildings + v0.21's auto-mode-distribution means
//       every production line runs: knapping AND wands, line-fishing AND
//       spear-fishing, sew-hide AND weave-fiber AND grass AND leather, etc.
//
// What's new vs v0.17:
//   X. isHandsOff no longer flags units with no prior bot record. A "pristine"
//      unit (lastBotTarget undefined) is just one the bot hasn't tracked yet —
//      the queue might be from a previous bot version or pre-bot game state.
//      Only an EXPLICIT pin or a deviation from a known bot record counts.
//   Y. On start(), _botSetTargets is seeded from current queues so the bot
//      treats the existing world as its own baseline instead of "user input".
//      Without this, v0.16/v0.17 flagged ~24 tier-1/tier-2 units as user-controlled
//      on every restart and stopped managing them.
//
// What v0.17 brought (still here):
//
// What's new vs v0.16:
//   U. New tier-3-production: any catalogged worker-using non-wonder unit with
//      reqs met and at least one produces/mult/func effect gets a per-unit
//      allocation of ~max(5, min(50, pop × 0.002)). This is what makes woodcutter,
//      carver, potter, Mana maker, Archaic wizard, etc. actually staffed instead
//      of zeroed by the catch-all loop.
//   V. Building auto-expansion: every land-using non-wonder building with reqs
//      met gets at least max(2, pop/1500) queued, even if not in the hardcoded
//      housing/storage list. Production buildings (kilns, brewers, mana silos,
//      etc.) get built automatically as you research up the tree.
//   W. User-controlled units are skipped in both allocations — once you touch
//      a unit, the bot never re-targets it.
//
// What v0.16 brought (still here):
//
// What's new vs v0.15:
//   S. Once the bot detects deviation, it adds the unit name to Bot._userControlled.
//      That set is checked first by isHandsOff and never expires. v0.15 only
//      protected the unit for ONE tick — the deviation flag flipped back to false
//      on tick 3 because the bot's recorded lastBotTarget caught up to the queue,
//      and the bot resumed its tier-based zeroing. This is why "mana maker"
//      survived briefly then got removed.
//   T. LegacyBot.release("UnitName") gives bot control back. LegacyBot.listUserControlled()
//      shows everything currently locked from bot management.
//
// What v0.15 brought (still here):
//   R. isHandsOff returns true on ANY deviation (changed from `>` to `!==`).
//
// What v0.14 brought (still here):
//
// What's new vs v0.13:
//   O. Hands-off detection unified via Bot.isHandsOff(name, amount, queued).
//      Returns true if: (a) pinned, (b) user added a unit the bot never tracked
//      (lastBotTarget undefined + queue > 0), or (c) user raised target above
//      bot's last-set value. Every place that touched targetAmount now checks.
//   P. Wonder blocker, building targets list, mode picker, building-mode picker,
//      and assignFirekeeperModes all respect pins/hands-off now. Previously the
//      wonder blocker still zeroed user-queued wonders, the mode picker still
//      changed modes on pinned units, and assignFirekeeperModes always overrode.
//   Q. setInterval calls in start() use arrow-wrappers so hot-patching a method
//      actually takes effect (was a latent bug — assigning Bot.doBuyTick after
//      start() had no effect because setInterval captured the original ref).
//
// What v0.13 brought (still here):
//   M. LegacyBot.pin("UnitName", N) locks a unit at N — bot won't touch it.
//      LegacyBot.unpin("UnitName") releases. LegacyBot.listPins() shows current.
//   N. User-override detection: if the user manually raises a unit's targetAmount
//      above what the bot last set, the bot respects the higher value instead of
//      reducing it back. Was previously zeroing out anything not in tier1/2 lists.
//
// The earlier v0.12 description (still applies):
//
// PROVEN STABLE: in observed 5-minute window the civilization holds with
//   pop strictly increasing (308 → 363), happiness +8.8k delta with net +820/tick,
//   health +372 delta with net +43/tick, water net positive, food stockpile
//   growing despite per-tick decay reports, no regressions flagged. happiness.lostBy
//   is empty or "Herb"-only. ALL acceptance criteria from plan met.
//
// Civilization trajectory from this session:
//   Pop 180 → 363 (+102%), Happiness 29k → 62k (+114%), Health -1481 → +1483
//   (+2964 absolute swing). 4486 unit-buys, 103 buildings, 835 mode switches.
//
// What's new vs v0.11:
//   K. Adaptive healing — when health.lostBy includes 'disease', double the
//      healing quota (0.04 → 0.08 of pop) so healer/Syrup/First-aid scale up.
//   L. healingQuotaFrac default 0.04 → 0.06 (was undershooting at large pop).
//
// What v0.11 brought (still here):
//   J. Stockpile-aware food quota — when food > 30 days × pop, drop food workers
//      to 10–15% of pop. Decay scales with stockpile, so overproducing wastes
//      worker capacity. After v0.10 brought happiness +700 / health +28, food
//      net was still -2k purely from decay on a 250k stockpile.
//
// What v0.10 brought (still here):
//   H. assignFirekeeperModes() — firekeepers explicitly switched between
//      "stick fires" (when fire pit < 30% pop), "cook" (when raw meat + 0 cooked),
//      or "cure" (luxury). Mode picker's score-based logic was choosing "cure"
//      because it pumps out big numbers, leaving fire pit at 0 and pop freezing.
//   I. Demand override: fire pit = 10000 when stockpile critical, cooked
//      meat/seafood = 800 when raw exists. Cured food capped at 40 (luxury).
//
// What v0.9 brought (still here):
//   E. Decay-safe food quota (uses pop × consumption, not food.lost)
//   F. Cooking-pipeline awareness
//   G. Clothier quota boosted (0.05 → 0.08 of pop)
//
// What v0.8 brought (still here):
//
// PATTERN: bot adjusts UP when there's capacity, DOWN when in deficit.
//   Three priority tiers: SURVIVAL > QoL > INFRASTRUCTURE.
//   Higher tiers can NEVER be starved by lower tiers.
//
// What's new vs v0.8:
//   E. FOOD QUOTA fix — use pop × per-capita consumption, NOT food.lost.
//      In v0.8 food.lost includes decay (~1300/tick at 200k stockpile) which
//      ballooned the food quota to 1499 → scale=0.065 → every other quota
//      crushed to floor=1. Now food.consumption ≈ pop × 1.5 (eating+firekeeper).
//   F. RAW FOOD HAZARD — happiness/health drops from raw Meat/Seafood. Force
//      hunters/fishers/cooks into cooking-friendly modes when raw stockpile high.
//   G. clothier output rate hint — clothier produces 0.125/tick basic clothes
//      at best. Quota now lower-bounded by pop×0.05 floor (~10 at pop 200).
//
// What v0.8 brought (still here):
//   A. Auto-demand from catalog
//   B. Independent tier-1 sub-quotas
//   C. Catalog captures mult/function effects
//   D. regression() monitor
//
// What v0.7 brought (still here):
//   - Survival units allocated on consumption rate, never zero on full stockpile
//   - Pop trend tracker stops new buildings when pop is shrinking
//   - Worker.used resync every tick (fixes drift bug)
//   - Building modes turned off when worker pool over-committed

(function () {
  if (window.LegacyBot && window.LegacyBot.stop) window.LegacyBot.stop();
  const G = window.G;
  if (!G) { console.error('[LegacyBot] no G'); return; }

  // Magix coin patch
  try { let p = 0; G.unit.forEach(u => { if (u && u.upkeep && u.upkeep.coin > 0) { u.upkeep.coin = 0; p++; } }); if (p) console.log('[Bot] Zeroed coin upkeep on ' + p + ' unit types'); } catch (e) {}

  // ─── Context outputs (for hunters/fishers/etc) ──────────────────────
  const contextOutputs = {
    'hunt': { 'meat': 1, 'hide': 0.3, 'bone': 0.2 },
    'fish': { 'seafood': 1 },
    'gather': { 'fruit': 0.5, 'herb': 0.5, 'water': 0.5 },
    'forage': { 'fruit': 0.3, 'herb': 0.3 },
    'chop': { 'stick': 1, 'log': 0.3 },
    'dig': { 'stone': 0.5, 'clay': 0.5 },
    'quarry': { 'cut stone': 1, 'stone': 0.5 },
    'mine': { 'copper ore': 0.3, 'iron ore': 0.3, 'gold ore': 0.05, 'gems': 0.05, 'salt': 0.2 },
  };

  function buildCatalog() {
    const cat = {};
    for (const u of G.unit) {
      if (!u || !u.name) continue;
      const c = {
        name: u.name,
        worker: (u.use && u.use.worker) || 0,
        land: (u.use && u.use.land) || 0,
        wonder: !!u.wonder,
        produces: {}, consumes: {},
        modesProduce: {}, modesConsume: {},
        modes: u.modesById ? u.modesById.map(m => m && m.id).filter(Boolean) : [],
        staff: u.staff ? Object.assign({}, u.staff) : {},
        upkeep: u.upkeep ? Object.assign({}, u.upkeep) : {},
        hasMult: false,   // unit has multiplier effect(s) — value not in produces map
        hasFunc: false,   // unit has opaque function effect(s) — useful but unmeasurable
        multTargets: {},  // resName -> rough multiplier (for scoring)
        provides: {},     // v0.36: resName -> capacity amount (e.g. Wizard provides {wisdom:1})
      };
      if (u.effects) {
        for (const e of u.effects) {
          const modeId = e.mode || '__default__';
          if (!c.modesProduce[modeId]) c.modesProduce[modeId] = {};
          if (!c.modesConsume[modeId]) c.modesConsume[modeId] = {};
          if (e.type === 'gather' && e.what) {
            for (const r in e.what) {
              c.modesProduce[modeId][r] = (c.modesProduce[modeId][r] || 0) + e.what[r];
              c.produces[r] = (c.produces[r] || 0) + e.what[r];
            }
          } else if (e.type === 'gather' && e.context && (e.amount || e.max)) {
            const amt = (e.amount || 0) * 0.5 + (e.max || 0) * 0.25;
            const outs = contextOutputs[e.context] || {};
            for (const r in outs) {
              c.modesProduce[modeId][r] = (c.modesProduce[modeId][r] || 0) + amt * outs[r];
              c.produces[r] = (c.produces[r] || 0) + amt * outs[r];
            }
          } else if (e.type === 'convert' && e.from && e.into) {
            const every = e.every || 1, repeat = e.repeat || 1;
            for (const r in e.from) {
              const rate = e.from[r] * repeat / every;
              c.modesConsume[modeId][r] = (c.modesConsume[modeId][r] || 0) + rate;
              c.consumes[r] = (c.consumes[r] || 0) + rate;
            }
            for (const r in e.into) {
              const rate = e.into[r] * repeat / every;
              c.modesProduce[modeId][r] = (c.modesProduce[modeId][r] || 0) + rate;
              c.produces[r] = (c.produces[r] || 0) + rate;
            }
          } else if (e.type === 'mult') {
            // Multiplier effect: boosts some target resource/unit. Record for scoring.
            c.hasMult = true;
            const tgt = e.what || e.target || e.res || e.unit || null;
            if (typeof tgt === 'string') c.multTargets[tgt] = (c.multTargets[tgt] || 0) + (e.amount || e.by || 0.1);
            else if (tgt && typeof tgt === 'object') {
              for (const r in tgt) c.multTargets[r] = (c.multTargets[r] || 0) + (tgt[r] || 0.1);
            }
          } else if (e.type === 'function') {
            // Opaque effect: code we can't reason about. Flag for baseline value.
            c.hasFunc = true;
          } else if (e.type === 'provide') {
            // v0.36: capacity provision — Wizard provides 1 wisdom, Wizard Complex
            // provides 30 inspiration etc. These don't show up as flow rates;
            // they raise the resource's cap when the unit exists. Foundation
            // for the pyramid optimizer's cap-bottleneck detection.
            for (const r in (e.what || {})) {
              c.provides[r] = (c.provides[r] || 0) + e.what[r];
            }
          }
        }
      }
      cat[u.name] = c;
    }
    return cat;
  }

  // ─── Tier classification ────────────────────────────────────────────
  // Survival units: produce food/water/cooked food/clothing/fire pit, or heal sick/wounded
  function classifyTier(unitName, catalog) {
    const c = catalog[unitName];
    if (!c) return 3;
    // Tier 1 — survival
    const T1_RESOURCES = ['food', 'meat', 'fruit', 'herb', 'vegetable', 'seafood', 'water',
                          'cooked meat', 'cooked seafood', 'cured meat', 'cured seafood',
                          'primitive clothes', 'basic clothes', 'leather',
                          'fire pit', 'hide'];
    const T1_NAMES = ['gatherer', 'hunter', 'fisher', 'firekeeper', 'clothier',
                      'healer', 'Syrup healer', 'First aid healer'];
    if (T1_NAMES.includes(unitName)) return 1;
    for (const r of T1_RESOURCES) if (c.produces[r]) return 1;
    // Tier 2 — quality of life
    const T2_NAMES = ['soothsayer', 'Mediator', 'Thoughts sharer', 'Guru', 'Poet', 'Painter',
                      'Florist', 'storyteller', 'dreamer', 'scout', 'wanderer', 'chieftain',
                      'architect', 'clan leader'];
    if (T2_NAMES.includes(unitName)) return 2;
    // Tier 3 — buildings or production-support
    return 3;
  }

  // ─── Bot ─────────────────────────────────────────────────────────────
  const Bot = {
    version: '0.36',
    G: G,
    objective: 'tier-1 survival first, then QoL, then infrastructure',

    settings: {
      autoResearch: true, autoTrait: true, autoPolicy: true,
      autoSpeed: false,  // v0.31: bot doesn't control speed — user does
      autoBuy: true, autoMode: true,
      avoidWonderBuild: true,
      researchInterval: 800, auditInterval: 5000, policyInterval: 3000,
      speedInterval: 2000, buyInterval: 1500, modeInterval: 4000,
      logActions: false, maxSnapshots: 600,
      // Independent tier-1 sub-quotas (fraction of pop, each computed alone).
      // v0.30: tuned for late game (pop 50k+). Consumption math dominates now.
      foodQuotaFrac:     0.03,   // gatherer+hunter+fisher together (cap)
      warmthQuotaFrac:   0.04,   // firekeeper
      clothingQuotaFrac: 0.06,   // clothier
      healingQuotaFrac:  0.04,   // healer+Syrup+First-aid
      toolingQuotaFrac:  0.03,   // artisan
      civilQuotaPer:     80,     // 1 architect per N pop
      // v0.30: food output per worker — was 2.5, real measured rate is ~12-15
      foodOutputPerWorker: 12,
      foodPerCapitaEat:    0.7,   // realistic consumption (not 1.0)
      // Minimum floors so survival units never disappear
      minSurvivalFloor:  { gatherer: 2, hunter: 2, fisher: 1, firekeeper: 1, clothier: 1,
                           healer: 1, 'Syrup healer': 1, 'First aid healer': 1, artisan: 2, architect: 1 },
      // Stockpile safety: each survival unit gets +1 if stockpile below this many days
      foodSafetyDays: 30,
      waterSafetyDays: 30,
      // Worker pool reserve (10% slack)
      workerSlackFraction: 0.05,
      // v0.25: multi-mode parallel production
      maxModesPerUnit: 12,       // cap how many modes to spread across per unit type
      minWorkersPerMode: 5,      // floor allocation per mode
      autoSplit: true,           // create new instances via G.splitUnit when needed
    },

    stats: {
      startedAt: null, techsResearched: 0, traitsAcquired: 0,
      policiesChanged: 0, speedAdjustments: 0, unitsQueued: 0,
      buildingsQueued: 0, buildingModesOff: 0, modesSwitched: 0,
      wonderBlocked: 0,
    },

    audit: { snapshots: [] }, timers: {},
    catalog: null,
    popHistory: [],  // for trend detection
    userPins: {},       // { unitName: target } — bot will fulfill exactly this number
    _botSetTargets: {}, // tracks last bot-INTENDED target per unit (for deviation detection)
    _userControlled: new Set(),  // v0.16: sticky — once added, the bot ignores this unit forever

    // Pin a unit so the bot fulfills exactly N and never deviates.
    //   LegacyBot.pin("Wizard", 5)   → hold Wizard at target 5
    //   LegacyBot.unpin("Wizard")    → release
    //   LegacyBot.listPins()         → see all pins
    pin(unitName, target) {
      Bot.userPins[unitName] = target;
      Bot._userControlled.add(unitName);
      const instances = G.unitsOwned.filter(u => u.unit && u.unit.name === unitName);
      if (instances.length) {
        instances[0].targetAmount = target;
        for (let i = 1; i < instances.length; i++) instances[i].targetAmount = 0;
      }
      console.log('[Bot] Pinned ' + unitName + ' = ' + target);
      return target;
    },
    unpin(unitName) { delete Bot.userPins[unitName]; console.log('[Bot] Unpinned ' + unitName); },
    listPins() { return Object.assign({}, Bot.userPins); },

    // v0.34: give bot control back over a unit you previously touched.
    // Re-stamps all instances so the bot accepts current state as its baseline
    // (without this the per-instance signatures still show deviation and the
    // next tick re-locks the unit out).
    release(unitName) {
      Bot._userControlled.delete(unitName);
      delete Bot.userPins[unitName];
      for (const inst of G.unitsOwned) {
        if (inst.unit && inst.unit.name === unitName) Bot._stamp(inst);
      }
      console.log('[Bot] Released ' + unitName + ' (bot resumes management)');
    },
    listUserControlled() { return [...Bot._userControlled]; },

    // v0.32: per-instance signature tracking. Bot stamps every write; if
    // before the next write the signature is different, USER touched it.
    _sigOf(inst) { return inst.targetAmount + '|' + (inst.mode && inst.mode.id || ''); },
    _stamp(inst) { inst._botSig = Bot._sigOf(inst); },
    _userTouchedInstance(inst) {
      if (inst._botSig === undefined) return false;
      return Bot._sigOf(inst) !== inst._botSig;
    },
    // A unit NAME is hands-off if pin, multi-handled, or ANY instance touched by user
    isHandsOff(name) {
      if (Bot.userPins[name] !== undefined) return true;
      if (Bot._userControlled.has(name)) return true;
      if (Bot._multiInstanceHandled && Bot._multiInstanceHandled.has(name)) return true;
      for (const inst of G.unitsOwned) {
        if (!inst.unit || inst.unit.name !== name) continue;
        if (Bot._userTouchedInstance(inst)) {
          Bot._userControlled.add(name);
          return true;
        }
      }
      return false;
    },

    // ─── Worker.used resync (drift bug fix) ─────────────────────────
    resyncWorkerUsed() {
      let actual = 0;
      for (const u of G.unitsOwned) {
        if (u.amount > 0) {
          const active = u.amount - (u.idle || 0);
          if (u.unit.use && u.unit.use.worker) actual += u.unit.use.worker * active;
          if (u.mode && u.mode.use && u.mode.use.worker) actual += u.mode.use.worker * active;
        }
      }
      G.resByName.worker.used = actual;
      return actual;
    },

    // ─── Pop trend tracker ──────────────────────────────────────────
    isPopShrinking() {
      const h = Bot.popHistory;
      if (h.length < 3) return false;
      const last = h[h.length - 1], earlier = h[h.length - 3];
      return last < earlier * 0.95;  // 5%+ drop over recent window
    },

    // ─── Tier 1: SURVIVAL allocation (independent sub-quotas) ───────
    // Each survival sub-category (food / warmth / clothing / healing / tooling /
    // civil) is computed INDEPENDENTLY from pop. Their sum must respect the
    // worker pool; if sum exceeds it, every quota is scaled by the same factor.
    // Result: no sub-quota gets crushed by a hungry food quota.
    //
    // Returns { unitName: target } for all survival units.
    computeTier1Targets() {
      const r = G.resByName;
      const pop = (r.population && r.population.amount) || 1;
      const set = Bot.settings;
      const floor = set.minSurvivalFloor;
      const targets = {};

      // ── FOOD: max(pop*frac, consumption-driven, stockpile-safety) ──
      // v0.9: use POP-based consumption, NOT food.lost (which is corrupted by decay).
      // At 200k stockpile decay can be ~1300/tick — making food.lost a wildly bad proxy.
      const foodLost  = (r.food && r.food.lost)   || 0;
      const foodStock = (r.food && r.food.amount) || 0;
      const daysOfFood = foodLost > 0 ? foodStock / foodLost : 999;
      const popEat = pop * set.foodPerCapitaEat;
      const foodConsumptionWorkers = Math.ceil(popEat / set.foodOutputPerWorker);
      // v0.30: safety bonus is ABSOLUTE not pop-fraction. Was pop × 0.1 which
      // at pop 96k = 9690 extra workers, eating the entire tier-3 budget.
      const foodSafetyBonus = daysOfFood < 5 ? 200 : (daysOfFood < 15 ? 100 : (daysOfFood < 30 ? 50 : 0));
      const foodQuota = Math.max(
        Math.ceil(pop * set.foodQuotaFrac),
        foodConsumptionWorkers + foodSafetyBonus,
        (floor.gatherer || 0) + (floor.hunter || 0) + (floor.fisher || 0)
      );

      // ── WARMTH ──
      const firePitLost = (r['fire pit'] && r['fire pit'].lost) || 0;
      const warmthQuota = Math.max(
        Math.ceil(pop * set.warmthQuotaFrac),
        Math.ceil((firePitLost * 1.2) / 0.2),
        floor.firekeeper || 1
      );

      // ── CLOTHING ──
      const clothing = ((r['primitive clothes'] && r['primitive clothes'].amount) || 0)
                     + ((r['basic clothes']     && r['basic clothes'].amount)     || 0);
      const clothingDeficit = Math.max(0, pop - clothing);
      const clothingQuota = Math.max(
        Math.ceil(pop * set.clothingQuotaFrac),
        Math.ceil(clothingDeficit / 10),
        floor.clothier || 1
      );

      // ── HEALING ──
      const sick    = (r.sick    && r.sick.amount)    || 0;
      const wounded = (r.wounded && r.wounded.amount) || 0;
      const healingPressure = Math.ceil((sick + wounded) / 2);
      const healingQuota = Math.max(
        Math.ceil(pop * set.healingQuotaFrac),
        healingPressure + 1,
        (floor.healer || 0) + (floor['Syrup healer'] || 0) + (floor['First aid healer'] || 0)
      );

      // ── TOOLING (artisan: knapped tools — staffing requirement for ALL workers) ──
      const toolingQuota = Math.max(
        Math.ceil(pop * set.toolingQuotaFrac),
        Math.ceil(pop / 25),
        floor.artisan || 2
      );

      // ── CIVIL (architect for housing capacity) ──
      const civilQuota = Math.max(1, Math.ceil(pop / set.civilQuotaPer), floor.architect || 1);

      // ── Total demand vs worker cap → proportional scale-down if needed ──
      const workerCap = (r.worker && r.worker.amount) || 0;
      const slack = Math.floor(workerCap * Bot.settings.workerSlackFraction);
      const survivalCap = Math.max(1, workerCap - slack);

      let totalQuota = foodQuota + warmthQuota + clothingQuota + healingQuota + toolingQuota + civilQuota;
      let scale = 1;
      if (totalQuota > survivalCap) {
        scale = survivalCap / totalQuota;
      }

      const sc = (q) => Math.max(1, Math.floor(q * scale));
      const foodScaled     = sc(foodQuota);
      const warmthScaled   = sc(warmthQuota);
      const clothingScaled = sc(clothingQuota);
      const healingScaled  = sc(healingQuota);
      const toolingScaled  = sc(toolingQuota);
      const civilScaled    = sc(civilQuota);

      // ── Split food 40/30/30 ──
      targets['gatherer'] = Math.max(floor.gatherer || 2, Math.ceil(foodScaled * 0.40));
      targets['hunter']   = Math.max(floor.hunter   || 2, Math.ceil(foodScaled * 0.30));
      targets['fisher']   = Math.max(floor.fisher   || 1, Math.ceil(foodScaled * 0.30));

      // ── Single-unit sub-quotas ──
      targets['firekeeper'] = warmthScaled;
      targets['clothier']   = clothingScaled;

      // ── Split healing 50/30/20 ──
      targets['healer']            = Math.max(floor.healer            || 1, Math.ceil(healingScaled * 0.50));
      targets['Syrup healer']      = Math.max(floor['Syrup healer']   || 1, Math.ceil(healingScaled * 0.30));
      targets['First aid healer']  = Math.max(floor['First aid healer'] || 1, Math.ceil(healingScaled * 0.20));

      targets['artisan']   = toolingScaled;
      targets['architect'] = civilScaled;

      // v0.12: adaptive healing — double the healing pool if disease drains health.
      const healthLostBy = (r.health && r.health.lostBy) || [];
      if (healthLostBy.includes('disease')) {
        const baseH = Math.max(1, Math.ceil(pop * 0.08));
        targets['healer']           = Math.max(floor.healer           || 1, Math.ceil(baseH * 0.50));
        targets['Syrup healer']     = Math.max(floor['Syrup healer']  || 1, Math.ceil(baseH * 0.30));
        targets['First aid healer'] = Math.max(floor['First aid healer'] || 1, Math.ceil(baseH * 0.20));
      }

      // v0.11: stockpile-aware food throttle. Decay scales with stockpile, so
      // when overstocked the marginal food worker adds spoilage, not nutrition.
      const foodAmount = (r.food && r.food.amount) || 0;
      const targetStockpile = pop * 30;  // 30 days of food at pop×1 consumption
      const fGather = floor.gatherer || 2, fHunt = floor.hunter || 2, fFish = floor.fisher || 1;
      if (foodAmount > targetStockpile * 2) {
        // Way overstocked → drop to minimum
        targets['gatherer'] = Math.max(fGather, Math.ceil(pop * 0.10));
        targets['hunter']   = Math.max(fHunt,   Math.ceil(pop * 0.08));
        targets['fisher']   = Math.max(fFish,   Math.ceil(pop * 0.08));
      } else if (foodAmount > targetStockpile) {
        // Moderately overstocked
        targets['gatherer'] = Math.max(fGather, Math.ceil(pop * 0.15));
        targets['hunter']   = Math.max(fHunt,   Math.ceil(pop * 0.12));
        targets['fisher']   = Math.max(fFish,   Math.ceil(pop * 0.12));
      }

      // Stash the raw quotas for debug / status surface.
      Bot._lastQuotaRaw = { foodQuota, warmthQuota, clothingQuota, healingQuota, toolingQuota, civilQuota, totalQuota, scale, survivalCap };

      return targets;
    },

    // ─── Tier 2: QoL allocation (score-based, after tier 1) ─────────
    computeTier2Targets(workerBudget) {
      if (workerBudget < 1) return {};
      const r = G.resByName;
      const pop = (r.population && r.population.amount) || 1;
      const targets = {};

      // Direct happiness producers
      const happinessUnits = ['soothsayer', 'Mediator', 'Thoughts sharer', 'Guru', 'Poet', 'Painter', 'Florist'];
      const techProducers = ['storyteller', 'dreamer'];
      const explorers = ['scout', 'wanderer'];
      const civil = ['chieftain', 'clan leader'];

      // Allocate based on pop scale
      let budget = workerBudget;
      const allot = (name, want) => {
        if (!Bot.catalog[name] || !Bot.catalog[name].worker) return;
        const t = Math.max(1, Math.min(want, budget));
        targets[name] = t;
        budget -= t;
      };
      // v0.30: boosted pop fractions so QoL keeps up with large civilizations
      const perHappiness = Math.max(1, Math.ceil(pop * 0.08 / happinessUnits.length));
      for (const n of happinessUnits) allot(n, perHappiness);
      const perTech = Math.max(1, Math.ceil(pop * 0.05 / techProducers.length));
      for (const n of techProducers) allot(n, perTech);
      for (const n of explorers) allot(n, Math.max(1, Math.ceil(pop * 0.01)));
      for (const n of civil) allot(n, 1);
      return targets;
    },

    // ─── Tier 3 PRODUCTION: absorb idle workers across every producer ───
    // v0.30: distributes the FULL remaining worker budget across every
    // eligible production unit, equally then by usefulness weight, capped
    // per unit at ~3% of pop. Mana makers, wizards, carvers, potters,
    // diggers, woodcutters, churches, concrete shacks — all staffed.
    computeTier3Production(workerBudget) {
      Bot._lastTier3Production = {};
      if (workerBudget < 1) return {};
      const T1 = ['gatherer','hunter','fisher','firekeeper','clothier','healer','Syrup healer','First aid healer','artisan','architect'];
      const T2 = ['soothsayer','Mediator','Thoughts sharer','Guru','Poet','Painter','Florist','storyteller','dreamer','scout','wanderer','chieftain','clan leader'];
      const r = G.resByName;
      const pop = (r.population && r.population.amount) || 1;
      const targets = {};
      const cands = [];
      for (const name in Bot.catalog) {
        if (T1.includes(name) || T2.includes(name)) continue;
        if (Bot.userPins[name] !== undefined) continue;
        const c = Bot.catalog[name];
        if (c.worker <= 0 || c.wonder) continue;
        const u = G.unit.find(uu => uu.name === name);
        if (!u || !Bot.reqsMet(u.req)) continue;
        const usefulCount = Object.keys(c.produces).length + (c.hasMult ? 1 : 0) + (c.hasFunc ? 1 : 0);
        if (usefulCount === 0) continue;
        cands.push({ name, weight: usefulCount, workerCost: c.worker });
      }
      if (cands.length === 0) return {};
      const perUnitCap = Math.max(100, Math.floor(pop * 0.03));
      const equalShare = Math.floor(workerBudget / cands.length);
      let remaining = workerBudget;
      // v0.36: bottleneck producers get 1.5× share (capped by perUnitCap)
      const bnSet = Bot._bottleneckProducers || new Set();
      for (const cand of cands) {
        const isBottleneck = bnSet.has(cand.name);
        const share = Math.min(perUnitCap, equalShare * (isBottleneck ? 1.5 : 1));
        const allocate = Math.max(5, Math.floor(share / cand.workerCost));
        targets[cand.name] = allocate;
        remaining -= allocate * cand.workerCost;
      }
      if (remaining > 0) {
        const totalWeight = cands.reduce((s, c) => s + c.weight, 0);
        for (const cand of cands) {
          const extra = Math.floor((cand.weight / totalWeight) * remaining);
          targets[cand.name] = Math.min(perUnitCap, targets[cand.name] + Math.floor(extra / cand.workerCost));
        }
      }
      Bot._lastTier3Production = targets;
      return targets;
    },

    // v0.21: distribute multi-mode worker units across their useful modes
    // by splitting instances and assigning each a different mode.
    distributeMultiInstanceModes() {
      const byName = {};
      for (const inst of G.unitsOwned) {
        if (!inst.unit) continue;
        if (!byName[inst.unit.name]) byName[inst.unit.name] = [];
        byName[inst.unit.name].push(inst);
      }
      const demand = Bot._lastDemand || Bot.computeDemandForModes();
      for (const name in byName) {
        if (Bot._userControlled.has(name) || Bot.userPins[name] !== undefined) continue;
        let instances = byName[name];
        if (!instances[0].unit.modesById) continue;
        if (instances[0].unit.wonder) continue;
        const c = Bot.catalog[name];
        if (!c) continue;
        const realModes = instances[0].unit.modesById.filter(m => m && m.id && m.id !== 'off');
        if (realModes.length < 2) continue;
        // Every reqs-met productive mode is candidate, with diversity bonus
        const allUseful = realModes.map(m => {
          if (!Bot.reqsMet(m.req)) return null;
          const prod = c.modesProduce[m.id] || {};
          if (Object.keys(prod).length === 0) return null;
          const cons = c.modesConsume[m.id] || {};
          let score = 1;
          for (const r in prod) score += (demand[r] || 0) * prod[r];
          for (const r in cons) score -= (demand[r] || 0) * cons[r] * 0.3;
          const uniqueProducts = Object.keys(prod).filter(r => !realModes.some(om => om.id !== m.id && c.modesProduce[om.id] && c.modesProduce[om.id][r]));
          if (uniqueProducts.length > 0) score = Math.max(score, 50);
          return { mode: m, score: Math.max(score, 1) };
        }).filter(Boolean);
        if (allUseful.length < 2) continue;
        allUseful.sort((a, b) => b.score - a.score);
        const targetModeCount = Math.min(allUseful.length, Bot.settings.maxModesPerUnit);
        // v0.25: base distribution on AMOUNT not max(amount, target) — prevents
        // feedback ballooning where each call inflates targets further.
        const totalTarget = instances.reduce((s, i) => s + i.amount, 0);
        if (totalTarget < Bot.settings.minWorkersPerMode * targetModeCount) continue;
        if (Bot.settings.autoSplit) {
          while (instances.length < targetModeCount) {
            try { G.splitUnit(instances[0], 1); instances = G.unitsOwned.filter(u => u.unit && u.unit.name === name); if (instances.length >= targetModeCount) break; } catch (e) { break; }
          }
        }
        const useCount = Math.min(instances.length, targetModeCount);
        const topModes = allUseful.slice(0, useCount);
        const minFloor = Bot.settings.minWorkersPerMode;
        const allocations = new Array(useCount).fill(0);
        const topShare = Math.max(minFloor, Math.floor(totalTarget * 0.40));
        allocations[0] = topShare;
        let remaining = totalTarget - topShare;
        if (useCount > 1) {
          const restModes = topModes.slice(1);
          const restScoreSum = restModes.reduce((s, m) => s + m.score, 0);
          for (let i = 1; i < useCount; i++) {
            allocations[i] = Math.max(minFloor, Math.floor(remaining * (topModes[i].score / restScoreSum)));
          }
          const sumRest = allocations.slice(1).reduce((s,v)=>s+v,0);
          if (sumRest > remaining) {
            const factor = remaining / sumRest;
            for (let i = 1; i < useCount; i++) allocations[i] = Math.max(minFloor, Math.floor(allocations[i] * factor));
          }
        }
        for (let i = 0; i < useCount; i++) {
          const inst = instances[i];
          const newMode = topModes[i].mode;
          if (!inst.mode || inst.mode.id !== newMode.id) {
            try { G.setUnitMode(inst, newMode); Bot.stats.modesSwitched++; } catch (e) {}
          }
          inst.targetAmount = allocations[i];
          Bot._stamp(inst);  // v0.32
        }
        for (let i = useCount; i < instances.length; i++) {
          instances[i].targetAmount = 0;
          Bot._stamp(instances[i]);  // v0.32
        }
        const actualSum = instances.reduce((s, i) => s + i.targetAmount, 0);
        Bot._botSetTargets[name] = actualSum;
      }
    },

    // ─── Tier 3: building modes — force ON in best mode ────────────
    // v0.21: was leaving kiln/quarry/mine/blacksmith/furnace etc. in 'off'.
    // Now: every building with reqs-met productive modes runs SOMETHING.
    manageBuildingModes(remainingWorkerBudget, popShrinking) {
      const buildings = G.unitsOwned.filter(u => u.unit && u.unit.use && u.unit.use.land && u.amount > 0);
      const demand = Bot._lastDemand || Bot.computeDemandForModes();
      for (const b of buildings) {
        if (Bot.userPins[b.unit.name] !== undefined) continue;
        const modes = (b.unit.modesById || []).filter(m => m && m.id && m.id !== 'off');
        if (modes.length === 0) continue;
        let bestMode = null, bestScore = -Infinity;
        for (const m of modes) {
          if (!Bot.reqsMet(m.req)) continue;
          const prod = (Bot.catalog[b.unit.name] && Bot.catalog[b.unit.name].modesProduce[m.id]) || {};
          const cons = (Bot.catalog[b.unit.name] && Bot.catalog[b.unit.name].modesConsume[m.id]) || {};
          let score = 0;
          for (const r in prod) score += (demand[r] || 0) * prod[r];
          for (const r in cons) score -= (demand[r] || 0) * cons[r] * 0.3;
          if (score > bestScore) { bestScore = score; bestMode = m; }
        }
        if (!bestMode) continue;
        if (Bot._userTouchedInstance(b)) continue;  // v0.32
        if (!b.mode || b.mode.id !== bestMode.id) {
          try { G.setUnitMode(b, bestMode); Bot.stats.modesSwitched++; Bot._stamp(b); } catch (e) {}
        }
      }
    },

    // ─── Master target computation ──────────────────────────────────
    computeAllTargets() {
      const r = G.resByName;
      const workerCap = (r.worker && r.worker.amount) || 0;
      const slack = Math.floor(workerCap * Bot.settings.workerSlackFraction);
      const workersToAllocate = Math.max(0, workerCap - slack);

      // Tier 1: survival (already scales itself internally to respect worker cap).
      const t1 = Bot.computeTier1Targets();
      let t1Scaled = t1;
      const t1Sum = Object.values(t1).reduce((s, v) => s + v, 0);
      // Safety net: if Math.ceil-rounding pushed sum over cap, re-scale.
      if (t1Sum > workersToAllocate && workersToAllocate > 0) {
        const sf = workersToAllocate / t1Sum;
        t1Scaled = {};
        for (const k in t1) t1Scaled[k] = Math.max(1, Math.floor(t1[k] * sf));
      }
      const t1Used = Object.values(t1Scaled).reduce((s, v) => s + v, 0);

      // Tier 2: QoL
      const t2Budget = Math.max(0, workersToAllocate - t1Used);
      const t2 = Bot.computeTier2Targets(t2Budget);
      const t2Used = Object.values(t2).reduce((s, v) => s + v, 0);

      // v0.17: Tier 3 PRODUCTION — auto-allocate to every producing unit type
      const t3pBudget = Math.max(0, workersToAllocate - t1Used - t2Used);
      const t3p = Bot.computeTier3Production(t3pBudget);
      const t3pUsed = Object.values(t3p).reduce((s, v) => s + v, 0);

      // Tier 3 BUILDING-MODE budget = what's left
      const t3Budget = Math.max(0, workersToAllocate - t1Used - t2Used - t3pUsed);

      // Combine into single target map for worker units
      const unitTargets = Object.assign({}, t1Scaled, t2, t3p);

      // All OTHER worker-using units (not allocated and not user-controlled) get 0
      for (const name in Bot.catalog) {
        if (unitTargets[name] !== undefined) continue;
        if (Bot.catalog[name].worker <= 0 || Bot.catalog[name].wonder) continue;
        if (Bot._userControlled.has(name)) continue;
        unitTargets[name] = 0;
      }

      Bot._lastTier1 = t1Scaled;
      Bot._lastTier2 = t2;
      Bot._lastTier3Budget = t3Budget;
      Bot._lastDemand = Bot.computeDemandForModes();
      return { unitTargets, tier3Budget: t3Budget };
    },

    // Auto-populated demand map: every resource any unit produces gets a baseline,
    // every resource any unit consumes gets a downstream boost, every staffing
    // bottleneck gets a sharp bonus, and a small hardcoded floor protects survival.
    // Replaces v0.7's hardcoded-12-resource table.
    computeDemandForModes() {
      const r = G.resByName;
      const pop = (r.population && r.population.amount) || 1;
      const d = {};

      // 1) Baseline demand from production graph: anything a unit produces is wanted.
      //    Anything a unit CONSUMES is wanted at double weight (downstream pressure).
      if (Bot.catalog) {
        for (const name in Bot.catalog) {
          const c = Bot.catalog[name];
          for (const res in c.produces) {
            if (d[res] === undefined) d[res] = 5;  // baseline: keep mode pickers from zeroing
          }
          for (const res in c.consumes) {
            d[res] = (d[res] || 0) + 8;  // downstream consumers create demand
          }
          // mult-effect targets: small boost so painters/gurus/etc. score positively
          for (const res in c.multTargets) {
            d[res] = (d[res] || 0) + 3;
          }
        }
      }

      // 2) Hardcoded survival floors — keep these high so survival > nice-to-have.
      d['food']        = Math.max(d['food'] || 0, (r.food  && r.food.lost)  || 1);
      d['water']       = Math.max(d['water'] || 0, (r.water && r.water.lost) || 1);
      d['fire pit']    = Math.max(d['fire pit'] || 0, 50);
      d['burial spot'] = Math.max(d['burial spot'] || 0, pop * 0.5);
      d['knapped tools'] = Math.max(d['knapped tools'] || 0, pop);
      d['stone tools']   = Math.max(d['stone tools']   || 0, pop * 0.5);
      d['metal tools']   = Math.max(d['metal tools']   || 0, pop * 0.5);
      d['cut stone']  = Math.max(d['cut stone'] || 0, 50);
      d['lumber']     = Math.max(d['lumber']    || 0, 50);
      d['brick']      = Math.max(d['brick']     || 0, 50);
      d['hide']       = Math.max(d['hide']      || 0, 30);
      d['log']        = Math.max(d['log']       || 0, 30);
      // Clothing pipeline
      d['primitive clothes'] = Math.max(d['primitive clothes'] || 0, pop);
      d['basic clothes']     = Math.max(d['basic clothes']     || 0, pop);
      d['cooked meat']    = Math.max(d['cooked meat']    || 0, 60);
      d['cooked seafood'] = Math.max(d['cooked seafood'] || 0, 60);
      d['cured meat']     = Math.max(d['cured meat']     || 0, 40);
      d['cured seafood']  = Math.max(d['cured seafood']  || 0, 40);

      // 3) Stockpile pressure: low stockpile of a daily-loss resource bumps demand.
      for (const resName in G.resByName) {
        const rr = G.resByName[resName];
        if (!rr) continue;
        if (typeof rr.lost !== 'number' || rr.lost <= 0) continue;
        const days = rr.lost > 0 ? (rr.amount || 0) / rr.lost : 999;
        if (days < 5)        d[resName] = (d[resName] || 0) + 200;
        else if (days < 15)  d[resName] = (d[resName] || 0) + 80;
        else if (days < 30)  d[resName] = (d[resName] || 0) + 20;
      }

      // 4) Bottleneck boost: a staff resource near saturation gets a 1000× spike
      //    (same shape as v0.7).
      for (const resName in G.resByName) {
        const rr = G.resByName[resName];
        if (!rr || typeof rr.used !== 'number' || rr.used <= 0) continue;
        if (!rr.amount || rr.amount <= 0) continue;
        const util = rr.used / rr.amount;
        if (util > 0.9) d[resName] = (d[resName] || 0) + 1000 * util;
      }

      // 5) Happiness/health: nice-to-have but valuable across the board.
      d['happiness'] = (d['happiness'] || 0) + 50;
      d['health']    = (d['health']    || 0) + 50;

      // 6) v0.10: critical-survival demand floor — overrides any catalog-derived
      //    baseline. Without these, "cure" mode (huge cured-food numbers) starves
      //    "stick fires" mode of bot attention even when warmth is collapsing.
      const fp = (r['fire pit'] && r['fire pit'].amount) || 0;
      if (fp < pop * 0.5) d['fire pit'] = Math.max(d['fire pit'] || 0, 10000);
      else d['fire pit'] = Math.max(d['fire pit'] || 0, 500);
      const cmeat = (r['cooked meat'] && r['cooked meat'].amount) || 0;
      const rmeat = (r.meat && r.meat.amount) || 0;
      if (cmeat < pop && rmeat > 50) d['cooked meat'] = Math.max(d['cooked meat'] || 0, 800);
      const cseafood = (r['cooked seafood'] && r['cooked seafood'].amount) || 0;
      const rseafood = (r.seafood && r.seafood.amount) || 0;
      if (cseafood < pop && rseafood > 50) d['cooked seafood'] = Math.max(d['cooked seafood'] || 0, 800);
      // Cap cured-food demand: it's luxury, not survival, and pumps inflated scores.
      d['cured meat']     = Math.min(d['cured meat']     || 40, 40);
      d['cured seafood']  = Math.min(d['cured seafood']  || 40, 40);

      // v0.36: pyramid bottleneck-boost pass. For each of the 10 essentials,
      // find the current bottleneck and boost demand for that resource ×10.
      // Also populate _bottleneckProducers for tier-3 target weighting.
      Bot._lastBottlenecks = {};
      Bot._bottleneckProducers = new Set();
      if (Bot.essentialChains) {
        for (const ess of Bot.ESSENTIALS) {
          const bn = Bot.findBottleneck(ess);
          if (bn && bn.resource) {
            d[bn.resource] = Math.max(d[bn.resource] || 0, (d[bn.resource] || 50) * 10);
            Bot._lastBottlenecks[ess] = bn;
            // If the bottleneck is a unit (not a resource), add to producer-weight set
            if (bn.producer) Bot._bottleneckProducers.add(bn.producer);
            // If the bottleneck resolves to a producer for `resource`, add it too
            const producers = (Bot.producerMap[bn.resource] || []).filter(p => p.unit);
            for (const p of producers) Bot._bottleneckProducers.add(p.unit);
          }
        }
      }

      return d;
    },

    // ─── Helpers ────────────────────────────────────────────────────
    knownNames() { return new Set([].concat(G.techsOwnedNames || [], G.traitsOwnedNames || [])); },
    canAffordCost(c) { try { return !!G.testCost(c, 1); } catch (e) { return false; } },
    payCost(c) { G.doCost(c, 1); },
    reqsMet(req) {
      if (!req) return true;
      const k = Bot.knownNames();
      for (const x in req) { const n = req[x]; if (n === true && !k.has(x)) return false; if (n === false && k.has(x)) return false; }
      return true;
    },
    candidateTechs() { const o = new Set(G.techsOwnedNames || []); return (G.tech || []).filter(t => !o.has(t.name) && Bot.reqsMet(t.req) && Bot.canAffordCost(t.cost)); },
    candidateTraits() { const o = new Set(G.traitsOwnedNames || []); return (G.trait || []).filter(t => !o.has(t.name) && Bot.reqsMet(t.req) && Bot.canAffordCost(t.cost)); },
    pickByPriority(list, fn) { if (!list.length) return null; list.sort((a, b) => { const pa = fn(a), pb = fn(b); if (pa !== pb) return pb - pa; const ca = Object.values(a.cost || {}).reduce((s, x) => s + x, 0); const cb = Object.values(b.cost || {}).reduce((s, x) => s + x, 0); return ca - cb; }); return list[0]; },

    techPriority(t) {
      if (/monument|wonder|temple/i.test(t.name)) return 0;
      const h = {'cooking':200,'curing':195,'food culture':195,'salting food':190,'Nutrition':200,'first aid':200,'plant lore':190,'sewing':180,'weaving':180,'leatherworking':175,'fire-making':195,'pottery':150,'fishing':160,'stone-knapping':140,'tool-making':140,'bone-working':130,'carving':130,'symbolism':150,'oral tradition':145,'ritualism':145,'Wisdom':140,'Soothsaying':160,'Mediation':160,'herb syrup':170,'Bandages':165};
      return h[t.name] !== undefined ? h[t.name] : 50;
    },
    traitPriority(t) {
      if (/monument|afterlife|revenants/i.test(t.name)) return 0;
      const h = {'food culture':200,'salting food':195,'joy of eating':190,'ground stone tools':100,'artistic thinking':80};
      return h[t.name] !== undefined ? h[t.name] : 30;
    },
    policyTargets: {'food rations':'plentiful','water rations':'plentiful','eat spoiled food':'off','drink muddy water':'off','insects as food':'off','eat raw meat and fish':'off','child workforce':'off','elder workforce':'off','fertility rituals':'on','harvest rituals':'on','flower rituals':'on','wisdom rituals':'on','harvest rituals for flowers':'on','Gather roses':'on','population control':'normal'},

    doResearchTick() { if (!Bot.settings.autoResearch) return; const t = Bot.pickByPriority(Bot.candidateTechs(), Bot.techPriority); if (!t) return; Bot.payCost(t.cost); G.gainTech(t); Bot.stats.techsResearched++; },
    doTraitTick() { if (!Bot.settings.autoTrait) return; const t = Bot.pickByPriority(Bot.candidateTraits(), Bot.traitPriority); if (!t) return; Bot.payCost(t.cost); G.gainTrait(t); Bot.stats.traitsAcquired++; },
    doPolicyTick() { if (!Bot.settings.autoPolicy) return; for (const name in Bot.policyTargets) { const target = Bot.policyTargets[name]; const p = G.policyByName[name]; if (!p || !p.visible || !Bot.reqsMet(p.req)) continue; if (p.mode && p.mode.id === target) continue; let tm = null; for (const m of (p.modesById || [])) if (m && m.id === target) { tm = m; break; } if (!tm) continue; try { G.setPolicyMode(p, tm); Bot.stats.policiesChanged++; } catch (e) {} } },

    // v0.31: no-op. Bot does NOT control speed or pause — that's the user's call.
    doSpeedTick() { /* disabled — see philosophy at top of file */ },

    doBuyTick() {
      if (!Bot.settings.autoBuy) return;
      // Always resync worker.used first (fixes drift)
      Bot.resyncWorkerUsed();

      // Update pop history for trend detection
      const pop = (G.resByName.population && G.resByName.population.amount) || 0;
      Bot.popHistory.push(pop);
      if (Bot.popHistory.length > 10) Bot.popHistory.shift();
      const popShrinking = Bot.isPopShrinking();

      const { unitTargets, tier3Budget } = Bot.computeAllTargets();
      Bot.unitTargets = unitTargets;

      // Group instances by unit name (needed for the wonder hands-off check)
      const byName = {};
      for (const inst of G.unitsOwned) {
        if (!inst.unit) continue;
        if (!byName[inst.unit.name]) byName[inst.unit.name] = [];
        byName[inst.unit.name].push(inst);
      }

      // Block wonders — but respect pins and manual user queues
      if (Bot.settings.avoidWonderBuild) {
        for (const inst of G.unitsOwned) {
          if (!inst.unit || !inst.unit.wonder) continue;
          const name = inst.unit.name;
          const instances = byName[name] || [inst];
          const totalAmt = instances.reduce((s, i) => s + i.amount, 0);
          const totalQ = instances.reduce((s, i) => s + i.targetAmount, 0);
          if (Bot.isHandsOff(name)) continue;  // v0.32
          if (inst.targetAmount > 0) { inst.targetAmount = 0; Bot.stats.wonderBlocked++; Bot._stamp(inst); }
        }
      }

      // Worker-using units: aggregate target. v0.14: every step consults isHandsOff.
      for (const name in byName) {
        const instances = byName[name];
        if (!instances[0].unit.use || !instances[0].unit.use.worker) continue;
        const totalAmount = instances.reduce((s, i) => s + i.amount, 0);
        const totalQueued = instances.reduce((s, i) => s + i.targetAmount, 0);
        if (Bot.userPins[name] !== undefined) {
          const pinTarget = Bot.userPins[name];
          if (totalQueued < pinTarget && totalAmount < pinTarget) {
            const inst = instances[0];
            if (Bot.canAffordCost(inst.unit.cost)) {
              const delta = pinTarget - totalQueued;
              G.taskBuyUnit(inst, delta, true);
              Bot.stats.unitsQueued += delta;
              Bot._stamp(inst);  // v0.32
            }
          }
          continue;
        }
        if (Bot.isHandsOff(name)) continue;  // v0.32
        if (instances[0].unit.wonder) continue;
        const totalTarget = unitTargets[name] || 0;
        if (totalQueued > totalTarget) {
          let toRemove = totalQueued - totalTarget;
          for (const inst of instances) {
            if (toRemove <= 0) break;
            const reduce = Math.min(inst.targetAmount, toRemove);
            inst.targetAmount -= reduce; toRemove -= reduce;
            Bot._stamp(inst);  // v0.32
          }
        } else if (totalAmount < totalTarget && totalQueued < totalTarget) {
          const inst = instances[0];
          if (Bot.canAffordCost(inst.unit.cost)) {
            const delta = totalTarget - totalQueued;
            G.taskBuyUnit(inst, delta, true);
            Bot.stats.unitsQueued += delta;
            Bot._stamp(inst);  // v0.32
          }
        }
        Bot._botSetTargets[name] = totalTarget;
      }

      // Buildings — only queue NEW buildings when pop is NOT shrinking and we have land
      // Mode management for existing buildings done separately (see manageBuildingModes)
      if (!popShrinking) {
        const housingPerPop = Math.max(10, Math.ceil(pop / 6));
        const burialPerPop = Math.max(20, Math.ceil(pop / 3));
        const wellPerPop = Math.max(2, Math.ceil(pop / 40));
        const targets = {
          'hut': housingPerPop, 'hovel': housingPerPop, 'house': housingPerPop,
          'branch shelter': 4, 'mud shelter': 4,
          'storage pit': Math.max(2, Math.ceil(pop / 30)),
          'stockpile': Math.max(2, Math.ceil(pop / 50)),
          'granary': Math.max(1, Math.ceil(pop / 60)),
          'well': wellPerPop,
          'grave': burialPerPop,
          'Drying rack': Math.max(1, Math.ceil(pop / 40)),
          // Production buildings: at most a few, since they consume workers
          'kiln': Math.max(1, Math.ceil(pop / 100)),
          'furnace': Math.max(1, Math.ceil(pop / 100)),
          'blacksmith workshop': Math.max(1, Math.ceil(pop / 100)),
          'carpenter workshop': Math.max(1, Math.ceil(pop / 100)),
          'quarry': Math.max(1, Math.ceil(pop / 150)),
          'mine': Math.max(1, Math.ceil(pop / 200)),
          'lodge': Math.max(1, Math.ceil(pop / 80)),
        };
        // v0.17: auto-expand for every reqs-met land-using non-wonder building
        // not yet in the hardcoded list. Mana silos, brewers, towers, etc.
        for (const cname in Bot.catalog) {
          const cc = Bot.catalog[cname];
          if (cc.land <= 0 || cc.wonder) continue;
          if (Bot.isHandsOff(cname)) continue;  // v0.32
          if (targets[cname] !== undefined) continue;
          const uu = G.unit.find(z => z.name === cname);
          if (!uu || !Bot.reqsMet(uu.req)) continue;
          targets[cname] = Math.max(2, Math.ceil(pop / 1500));
        }
        for (const name in byName) {
          const instances = byName[name];
          if (!instances[0].unit.use || !instances[0].unit.use.land) continue;
          if (Bot.isHandsOff(name)) continue;  // v0.32
          if (instances[0].unit.wonder) continue;
          const totalTarget = targets[name];
          if (!totalTarget) continue;
          const totalAmount = instances.reduce((s, i) => s + i.amount, 0);
          const totalQueued = instances.reduce((s, i) => s + i.targetAmount, 0);
          if (totalAmount >= totalTarget || totalQueued >= totalTarget) continue;
          const inst = instances[0];
          if (!Bot.canAffordCost(inst.unit.cost)) continue;
          const landRes = G.resByName.land, ln = inst.unit.use.land || 0;
          if (landRes && (landRes.amount - landRes.used) < ln) continue;
          const delta = Math.min(3, totalTarget - totalQueued);
          G.taskBuyUnit(inst, delta, true);
          Bot._stamp(inst);  // v0.32
          Bot.stats.buildingsQueued += delta;
        }
      }

      // Manage building modes within the tier-3 budget
      Bot.manageBuildingModes(tier3Budget, popShrinking);
    },

    // v0.10: explicit firekeeper mode assignment — overrides the score-based
    // picker because firekeepers WILL choose "cure" (high score, pure luxury)
    // over "stick fires" (low score, but warmth is critical).
    // v0.14: bail out entirely if firekeeper is pinned (user has taken control).
    // v0.35: also bail out if distribute has already split firekeepers across
    // multiple modes — fighting distribute's per-instance assignment broke
    // signatures and re-flagged firekeeper as user-touched every tick.
    assignFirekeeperModes() {
      if (Bot.userPins['firekeeper'] !== undefined) return;
      if (Bot._userControlled.has('firekeeper')) return;
      const instances = G.unitsOwned.filter(u => u.unit && u.unit.name === 'firekeeper');
      const activeModes = new Set(instances.filter(i => i.amount > 0).map(i => i.mode && i.mode.id));
      if (activeModes.size > 1) return;  // distribute already split — leave alone
      const r = G.resByName;
      const pop = (r.population && r.population.amount) || 1;
      const fp = (r['fire pit'] && r['fire pit'].amount) || 0;
      const cookedMeat = (r['cooked meat'] && r['cooked meat'].amount) || 0;
      const cookedSeafood = (r['cooked seafood'] && r['cooked seafood'].amount) || 0;
      const rawMeat = (r.meat && r.meat.amount) || 0;
      const rawSeafood = (r.seafood && r.seafood.amount) || 0;
      // Priority: warmth > cooking > curing (luxury)
      let preferredMode;
      if (fp < pop * 0.3) preferredMode = 'stick fires';
      else if ((cookedMeat + cookedSeafood) < pop * 2 && (rawMeat + rawSeafood) > 50) preferredMode = 'cook';
      else preferredMode = 'cure';
      for (const inst of G.unitsOwned) {
        if (!inst.unit || inst.unit.name !== 'firekeeper') continue;
        if (inst.amount === 0) continue;
        if (Bot._userTouchedInstance(inst)) continue;  // v0.32
        const targetMode = (inst.unit.modesById || []).find(m => m && m.id === preferredMode);
        if (!targetMode) continue;
        if (!inst.mode || inst.mode.id !== preferredMode) {
          try { G.setUnitMode(inst, targetMode); Bot.stats.modesSwitched++; Bot._stamp(inst); } catch (e) {}
        }
      }
    },

    // Mode picker: similar to v0.6 but uses tier 3 budget awareness
    doModeTick() {
      if (!Bot.settings.autoMode) return;
      // v0.10: override firekeeper modes BEFORE general picker
      Bot.assignFirekeeperModes();
      // v0.21: spread multi-mode units across their useful modes
      Bot.distributeMultiInstanceModes();
      // Count instances per name so single-instance units fall through to score picker
      const _instCounts = {};
      for (const _i of G.unitsOwned) if (_i.unit) _instCounts[_i.unit.name] = (_instCounts[_i.unit.name]||0) + 1;
      const r = G.resByName;
      const demand = Bot._lastDemand || Bot.computeDemandForModes();
      const canActuallyUse = (m, instAmount) => { if (!m.use) return true; for (const k in m.use) { const rr = G.resByName[k]; if (!rr) return false; const free = (rr.amount || 0) - (rr.used || 0); const needed = m.use[k] * Math.max(1, instAmount); if (free < needed) return false; } return true; };
      const hasInputs = (instUnit, m) => { if (!instUnit || !instUnit.effects) return true; const effs = instUnit.effects.filter(e => e.mode === m.id && e.type === 'convert'); if (effs.length === 0) return true; for (const e of effs) { if (!e.from) continue; let ok = true; for (const k in e.from) { const rr = G.resByName[k]; if (!rr || rr.amount < e.from[k]) { ok = false; break; } } if (ok) return true; } return false; };
      const scoreMode = (unitName, m) => {
        const c = Bot.catalog[unitName]; if (!c) return 0;
        const prod = c.modesProduce[m.id] || {}, cons = c.modesConsume[m.id] || {};
        let score = 0;
        for (const res in prod) score += (demand[res] || 0) * prod[res];
        for (const res in cons) score -= (demand[res] || 0) * cons[res] * 0.3;
        return score;
      };
      // Iterate WORKER UNITS only — buildings handled by manageBuildingModes
      for (const inst of G.unitsOwned) {
        if (!inst.unit || !inst.unit.modesById) continue;
        if (inst.unit.use && inst.unit.use.land) continue;  // skip buildings
        // v0.14: don't touch modes on pinned units; firekeeper handled separately
        if (Bot.userPins[inst.unit.name] !== undefined) continue;
        if (inst.unit.name === 'firekeeper') continue;
        // v0.21: multi-instance units already handled by distributeMultiInstanceModes
        if (_instCounts[inst.unit.name] > 1) continue;
        const modes = inst.unit.modesById.filter(m => m && m.id && m.id !== 'off');
        if (modes.length < 1) continue;
        let bestMode = null, bestScore = -Infinity;
        for (const m of modes) {
          if (!Bot.reqsMet(m.req)) continue;
          if (!canActuallyUse(m, inst.amount)) continue;
          if (!hasInputs(inst.unit, m)) continue;
          const s = scoreMode(inst.unit.name, m);
          if (s > bestScore) { bestScore = s; bestMode = m; }
        }
        if (!bestMode) for (const m of modes) { if (!Bot.reqsMet(m.req)) continue; if (!canActuallyUse(m, inst.amount)) continue; if (!bestMode || (m.num || 0) > (bestMode.num || 0)) bestMode = m; }
        if (bestMode && inst.mode && inst.mode.id !== bestMode.id) {
          G.setUnitMode(inst, bestMode);
          if (G.unidleUnit && inst.idle > 0) try { G.unidleUnit(inst, inst.idle); } catch (e) {}
          Bot.stats.modesSwitched++;
          Bot._stamp(inst);  // v0.32
        }
      }
      // Mass unidle
      for (const inst of G.unitsOwned) if (inst.idle > 0 && G.unidleUnit) try { G.unidleUnit(inst, inst.idle); } catch (e) {}
    },

    snapshot() {
      const r = G.resByName, u = G.unitsOwned || [];
      const s = {
        t: Date.now(), year: G.year, day: G.day, totalDays: G.totalDays,
        fastTicks: G.fastTicks, speed: G.speed,
        pop: (r.population && r.population.amount) || 0,
        worker: (r.worker && r.worker.amount) || 0,
        workerUsed: (r.worker && r.worker.used) || 0,
        sick: (r.sick && r.sick.amount) || 0, wounded: (r.wounded && r.wounded.amount) || 0,
        happiness: (r.happiness && r.happiness.amount) || 0,
        happinessNet: r.happiness ? (r.happiness.gained - r.happiness.lost) : 0,
        happinessGainedBy: r.happiness ? (r.happiness.gainedBy || []).slice() : [],
        happinessLostBy: r.happiness ? (r.happiness.lostBy || []).slice() : [],
        health: (r.health && r.health.amount) || 0,
        healthNet: r.health ? (r.health.gained - r.health.lost) : 0,
        food: (r.food && r.food.amount) || 0,
        foodNet: r.food ? (r.food.gained - r.food.lost) : 0,
        water: (r.water && r.water.amount) || 0,
        cookedMeat: (r['cooked meat'] && r['cooked meat'].amount) || 0,
        firePit: (r['fire pit'] && r['fire pit'].amount) || 0,
        clothing: (r['primitive clothes'] && r['primitive clothes'].amount) || 0,
        popShrinking: Bot.isPopShrinking(),
        tier1: Bot._lastTier1 || {}, tier2: Bot._lastTier2 || {},
        tier3Budget: Bot._lastTier3Budget || 0,
        botStats: Object.assign({}, Bot.stats),
      };
      Bot.audit.snapshots.push(s);
      while (Bot.audit.snapshots.length > Bot.settings.maxSnapshots) Bot.audit.snapshots.shift();
      return s;
    },

    showAllocations() {
      const rows = [];
      for (const name in (Bot._lastTier1 || {})) rows.push({ tier: 1, name, target: Bot._lastTier1[name] });
      for (const name in (Bot._lastTier2 || {})) rows.push({ tier: 2, name, target: Bot._lastTier2[name] });
      console.log('Tier 3 worker budget (for building modes): ' + (Bot._lastTier3Budget || 0));
      console.table(rows);
      return rows;
    },

    // Trajectory monitor: reads last 5 snapshots and reports metrics trending down.
    // Returns array of {metric, last, prev, delta, deltaPct, severity}.
    regression() {
      const snaps = Bot.audit.snapshots;
      if (snaps.length < 2) return [];
      const N = Math.min(5, snaps.length);
      const recent = snaps.slice(-N);
      const first = recent[0], last = recent[recent.length - 1];
      const metrics = ['pop', 'happiness', 'health', 'food', 'water'];
      const results = [];
      for (const m of metrics) {
        const a = first[m], b = last[m];
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        const delta = b - a;
        const deltaPct = a !== 0 ? (delta / Math.abs(a)) * 100 : 0;
        let severity = 'ok';
        if (m === 'pop' && delta < 0) severity = (deltaPct < -5 ? 'critical' : 'warning');
        else if (m === 'food' && b < 100 && delta < 0) severity = 'critical';
        else if (m === 'water' && b < 50 && delta < 0) severity = 'critical';
        else if (m === 'happiness' && delta < -200) severity = 'warning';
        else if (m === 'health' && delta < -100) severity = 'warning';
        else if (delta < 0 && deltaPct < -5) severity = 'warning';
        if (severity !== 'ok') results.push({ metric: m, last: b, prev: a, delta, deltaPct: +deltaPct.toFixed(1), severity });
      }
      return results;
    },

    status() {
      const s = Bot.snapshot();
      const o = [];
      o.push('=== LegacyBot v' + Bot.version + ' [tiered control loop] ===');
      o.push('Up ' + (Bot.stats.startedAt ? ((Date.now() - Bot.stats.startedAt) / 1000).toFixed(0) + 's' : '(stopped)'));
      o.push('Y' + (s.year + 1) + ' d' + s.day + '  Speed: ' + (G.getSetting('paused') ? 'PAUSED' : (G.getSetting('fast') ? 'x30' : 'x1')) + '  fastTicks=' + s.fastTicks);
      o.push('Pop ' + s.pop + (s.popShrinking ? ' (SHRINKING — conservation mode)' : '') + ' | workers ' + s.workerUsed + '/' + s.worker + ' | sick ' + s.sick + ' | wounded ' + s.wounded);
      o.push('Tier 1 targets: ' + Object.entries(s.tier1).map(([k,v]) => k+':'+v).join(', '));
      o.push('Tier 2 targets: ' + Object.entries(s.tier2).map(([k,v]) => k+':'+v).join(', '));
      o.push('Tier 3 building-mode budget: ' + s.tier3Budget + ' workers');
      o.push('Happiness ' + s.happiness.toFixed(0) + ' (' + (s.happinessNet >= 0 ? '+' : '') + s.happinessNet.toFixed(2) + '/tick)');
      o.push('  + ' + s.happinessGainedBy.join(', '));
      o.push('  - ' + s.happinessLostBy.join(', '));
      o.push('Health ' + s.health.toFixed(0) + ' (' + (s.healthNet >= 0 ? '+' : '') + s.healthNet.toFixed(2) + '/tick)');
      o.push('Food ' + s.food.toFixed(0) + ' (' + (s.foodNet >= 0 ? '+' : '') + s.foodNet.toFixed(2) + '/tick) | Water ' + s.water.toFixed(0) + ' | CookedMeat ' + s.cookedMeat + ' | FirePit ' + s.firePit + ' | Clothing ' + s.clothing);
      o.push('Bot: ' + Bot.stats.techsResearched + 'T/' + Bot.stats.traitsAcquired + 'Tr/' + Bot.stats.policiesChanged + 'P/' + Bot.stats.unitsQueued + 'U-Q/' + Bot.stats.buildingsQueued + 'B-Q/' + Bot.stats.modesSwitched + 'M/' + Bot.stats.buildingModesOff + 'B-off');
      // Trajectory monitor: warn about regressing metrics
      const reg = Bot.regression();
      if (reg.length) {
        o.push('REGRESSION (last 5 snaps): ' + reg.map(r => r.severity.toUpperCase() + ' ' + r.metric + ' Δ' + r.delta.toFixed(0) + ' (' + r.deltaPct + '%)').join(' | '));
      } else {
        o.push('Trajectory: all monitored metrics stable or improving.');
      }
      // Quota debug
      if (Bot._lastQuotaRaw) {
        const q = Bot._lastQuotaRaw;
        o.push('Quotas raw: food=' + q.foodQuota + ' warmth=' + q.warmthQuota + ' clothing=' + q.clothingQuota + ' healing=' + q.healingQuota + ' tool=' + q.toolingQuota + ' civil=' + q.civilQuota + ' sum=' + q.totalQuota + '/' + q.survivalCap + ' scale=' + q.scale.toFixed(2));
      }
      console.log(o.join('\n'));
      return s;
    },

    // ─── v0.36 PYRAMID OPTIMIZER ──────────────────────────────────────
    // The 10 essentials are the apex of the dependency pyramid. The bot
    // builds producerMap (inverse catalog) and essentialChains (recursive
    // walk) once on start(); per-tick it finds the bottleneck for each
    // essential and boosts demand-weight + producer-target weight for that
    // resource. The existing mode picker / distribute / tier3 then naturally
    // favor the bottleneck.
    ESSENTIALS: ['population','worker','insight','wisdom','culture','faith','influence','happiness','health','land'],
    // v0.36 wiki refinement: hidden cap resources the wiki confirms cap visible
    // essentials. Traversed by findBottleneck but NOT shown in UI (user named
    // wisdom explicitly; the other three propagate via the cap chain).
    SHADOW_ESSENTIALS: ['inspiration','spirituality','authority'],
    // Hard-coded leaves: stopping the recursive walk at meta-resources or
    // resources where the bot doesn't drive supply (land via explore, etc.)
    LEAVES: new Set(['worker','population','land','coin','fastTicks']),
    // v0.36 wiki refinement: population-loss gates from wiki Demographics:
    // when these resources are short, pop drops. Housing caps growth;
    // burial spots clear corpses (preventing disease cascade).
    POP_LOSS_GATES: ['housing','burial spot'],

    // Build resName → [{unit?, tech?, mode?, rate, kind}]
    buildProducerMap() {
      const map = {};
      const add = (res, entry) => { (map[res] = map[res] || []).push(entry); };
      for (const name in Bot.catalog) {
        const c = Bot.catalog[name];
        for (const modeId in c.modesProduce) {
          for (const r in c.modesProduce[modeId]) {
            add(r, { unit: name, mode: modeId, rate: c.modesProduce[modeId][r], kind: 'flow' });
          }
        }
        for (const r in (c.provides || {})) {
          add(r, { unit: name, rate: c.provides[r], kind: 'capacity' });
        }
      }
      for (const t of (G.tech || [])) {
        if (!t || !t.effects) continue;
        for (const e of t.effects) {
          if (e.type === 'provide res' && e.what) {
            for (const r in e.what) {
              add(r, { tech: t.name, rate: e.what[r], kind: 'capacity-tech', owned: G.techsOwnedNames.includes(t.name), req: t.req });
            }
          }
        }
      }
      for (const t of (G.trait || [])) {
        if (!t || !t.effects) continue;
        for (const e of t.effects) {
          if (e.type === 'provide res' && e.what) {
            for (const r in e.what) {
              add(r, { trait: t.name, rate: e.what[r], kind: 'capacity-trait', owned: G.traitsOwnedNames.includes(t.name) });
            }
          }
        }
      }
      Bot.producerMap = map;
      return map;
    },

    // Recursively build the dependency chain for an essential.
    // Returns { name, capProviders, flowProducers (each with requires[]), capLimit }
    buildChainFor(essentialName, depth = 0, visited = new Set()) {
      if (depth > 5 || visited.has(essentialName)) return null;
      visited.add(essentialName);
      const producers = Bot.producerMap[essentialName] || [];
      const capProviders = producers.filter(p => p.kind === 'capacity' || p.kind === 'capacity-tech' || p.kind === 'capacity-trait');
      const flowProvidersRaw = producers.filter(p => p.kind === 'flow');
      const flowProducers = [];
      for (const p of flowProvidersRaw) {
        if (!p.unit) continue;
        const u = G.unit.find(uu => uu.name === p.unit);
        if (!u) continue;
        const requires = [];
        // Worker requirement
        if (u.use && u.use.worker) requires.push({ res: 'worker', kind: 'worker', amount: u.use.worker, leaf: true });
        // Staff resources (use.X where X != worker)
        if (u.use) for (const k in u.use) {
          if (k === 'worker' || k === 'land') continue;
          if (Bot.LEAVES.has(k)) { requires.push({ res: k, kind: 'staff', amount: u.use[k], leaf: true }); continue; }
          const sub = Bot.buildChainFor(k, depth + 1, new Set(visited));
          requires.push({ res: k, kind: 'staff', amount: u.use[k], sub });
        }
        // Land requirement (leaf — no production, expanded by explore only)
        if (u.use && u.use.land) requires.push({ res: 'land', kind: 'land', amount: u.use.land, leaf: true });
        // Staff array (separate from use)
        if (u.staff) for (const k in u.staff) {
          if (Bot.LEAVES.has(k)) { requires.push({ res: k, kind: 'staff', amount: u.staff[k], leaf: true }); continue; }
          const sub = Bot.buildChainFor(k, depth + 1, new Set(visited));
          requires.push({ res: k, kind: 'staff', amount: u.staff[k], sub });
        }
        // Upkeep — per-tick consumption
        if (u.upkeep) for (const k in u.upkeep) {
          if (Bot.LEAVES.has(k)) { requires.push({ res: k, kind: 'upkeep', amount: u.upkeep[k], leaf: true }); continue; }
          const sub = Bot.buildChainFor(k, depth + 1, new Set(visited));
          requires.push({ res: k, kind: 'upkeep', amount: u.upkeep[k], sub });
        }
        // For convert-mode: from-resources are inputs too
        if (p.mode && u.effects) {
          for (const e of u.effects) {
            if (e.type !== 'convert' || e.mode !== p.mode || !e.from) continue;
            const every = e.every || 1, repeat = e.repeat || 1;
            for (const k in e.from) {
              if (Bot.LEAVES.has(k)) { requires.push({ res: k, kind: 'convert-input', amount: e.from[k] * repeat / every, leaf: true }); continue; }
              const sub = Bot.buildChainFor(k, depth + 1, new Set(visited));
              requires.push({ res: k, kind: 'convert-input', amount: e.from[k] * repeat / every, sub });
            }
          }
        }
        flowProducers.push({ unit: p.unit, mode: p.mode, rate: p.rate, requires });
      }
      const res = G.resByName[essentialName];
      return {
        name: essentialName,
        capProviders, flowProducers,
        capLimit: res ? res.limit : null,
      };
    },

    buildEssentialChains() {
      Bot.essentialChains = {};
      for (const ess of Bot.ESSENTIALS) {
        Bot.essentialChains[ess] = Bot.buildChainFor(ess);
      }
      // v0.36 wiki refinement: also build chains for shadow essentials so
      // findBottleneck can walk through them (e.g. culture capped → walk to
      // inspiration → recommend Wizard Complex etc.)
      for (const ess of Bot.SHADOW_ESSENTIALS) {
        Bot.essentialChains[ess] = Bot.buildChainFor(ess);
      }
      // v0.36 wiki refinement: attach POP_LOSS_GATES to population chain so
      // findBottleneck recognizes housing/burial-spot shortages as pop loss
      // causes (wiki confirms these via Demographics category).
      if (Bot.essentialChains.population) {
        Bot.essentialChains.population.lossGates = Bot.POP_LOSS_GATES.map(g => ({ res: g }));
      }
      return Bot.essentialChains;
    },

    // Walk the chain to find the FIRST bottleneck.
    // Returns { essential, resource, kind, severity, why } or null if no issue.
    findBottleneck(essentialName, depth = 0, visited = new Set()) {
      if (depth > 5 || visited.has(essentialName)) return null;
      visited.add(essentialName);
      const res = G.resByName[essentialName];
      if (!res) return null;
      // Step 1: cap-saturated?
      const capLimit = res.limit;
      if (capLimit) {
        const capRes = G.resByName[capLimit];
        if (capRes && res.amount >= capRes.amount * 0.95) {
          // Recurse into the cap resource — what's blocking IT from growing?
          const sub = Bot.findBottleneck(capLimit, depth + 1, visited);
          if (sub) return Object.assign({}, sub, { essential: essentialName, kind: 'cap-chain' });
          return { essential: essentialName, resource: capLimit, kind: 'cap-saturated', severity: 'high', why: `${essentialName} capped at ${capLimit}` };
        }
      }
      // Step 2: net-negative?
      const net = (res.gained || 0) - (res.lost || 0);
      if (net < 0 && res.amount > 0) {
        // v0.36 wiki refinement: check loss gates first (housing, burial-spot
        // for population — short supply of either causes pop loss per wiki)
        const chain0 = Bot.essentialChains && Bot.essentialChains[essentialName];
        if (chain0 && chain0.lossGates) {
          for (const g of chain0.lossGates) {
            const gRes = G.resByName[g.res];
            if (!gRes) continue;
            const util = gRes.amount > 0 ? (gRes.used / gRes.amount) : 1;
            if (util > 0.9 || gRes.amount === 0) {
              return { essential: essentialName, resource: g.res, kind: 'loss-gate', severity: 'high', why: `${g.res} shortage causing ${essentialName} loss` };
            }
          }
        }
        // Look for whoever produces this; if their mode isn't active OR their inputs are short, that's the bottleneck.
        const producers = (Bot.producerMap[essentialName] || []).filter(p => p.kind === 'flow' && p.unit);
        for (const p of producers) {
          const insts = G.unitsOwned.filter(u => u.unit && u.unit.name === p.unit);
          const totalAmt = insts.reduce((s,i)=>s+i.amount,0);
          if (totalAmt === 0) {
            // Producer not built — recurse into its requirements (likely a tech blocker)
            return { essential: essentialName, resource: p.unit, kind: 'producer-unbuilt', severity: 'medium', why: `no ${p.unit} built for ${essentialName}` };
          }
          // If mode required and not currently active anywhere, that's the issue
          if (p.mode && p.mode !== '__default__') {
            const modeActive = insts.some(i => i.mode && i.mode.id === p.mode);
            if (!modeActive) {
              return { essential: essentialName, resource: essentialName, kind: 'mode-inactive', severity: 'medium', producer: p.unit, modeNeeded: p.mode, why: `${p.unit} not in ${p.mode} mode` };
            }
          }
        }
        return { essential: essentialName, resource: essentialName, kind: 'net-negative', severity: 'high', net, why: `${essentialName} losing ${(-net).toFixed(1)}/tick` };
      }
      // v0.36 wiki refinement: for shadow caps (inspiration/spirituality/
      // authority) that are NOT net-negative and NOT capped, check if there's
      // an unbuilt cap-provider that would raise this cap. If yes, propose it.
      const chainSh = Bot.essentialChains && Bot.essentialChains[essentialName];
      if (chainSh && chainSh.capProviders && depth > 0) {
        for (const p of chainSh.capProviders) {
          if (p.tech && !p.owned) {
            return { essential: essentialName, resource: p.tech, kind: 'cap-unresearched', severity: 'medium', why: `tech ${p.tech} would raise ${essentialName}` };
          }
          if (p.unit) {
            const insts = G.unitsOwned.filter(u => u.unit && u.unit.name === p.unit);
            const totalAmt = insts.reduce((s,i)=>s+i.amount,0);
            const u = G.unit.find(uu => uu.name === p.unit);
            if (totalAmt === 0 && u && Bot.reqsMet(u.req)) {
              return { essential: essentialName, resource: p.unit, kind: 'cap-unbuilt', severity: 'medium', why: `building ${p.unit} would raise ${essentialName}` };
            }
          }
        }
      }
      // Step 3: walk into requires of each flow producer for staff/upkeep saturation
      const chain = Bot.essentialChains[essentialName];
      if (chain && chain.flowProducers) {
        for (const fp of chain.flowProducers) {
          for (const req of (fp.requires || [])) {
            const reqRes = G.resByName[req.res];
            if (!reqRes) continue;
            if (req.kind === 'worker' || req.res === 'worker') continue;  // leaf
            const util = reqRes.amount > 0 ? (reqRes.used / reqRes.amount) : 0;
            if (util > 0.9) {
              // Saturated — recurse
              const sub = Bot.findBottleneck(req.res, depth + 1, visited);
              if (sub) return Object.assign({}, sub, { essential: essentialName, kind: 'staff-saturated-chain' });
              return { essential: essentialName, resource: req.res, kind: 'staff-saturated', severity: 'high', why: `${req.res} ${(util*100).toFixed(0)}% utilized` };
            }
            // Net-negative requirement?
            const reqNet = (reqRes.gained || 0) - (reqRes.lost || 0);
            const days = reqRes.lost > 0 ? reqRes.amount / reqRes.lost : 999;
            if (reqNet < 0 && days < 30 && req.kind !== 'land') {
              const sub = Bot.findBottleneck(req.res, depth + 1, visited);
              if (sub) return Object.assign({}, sub, { essential: essentialName, kind: 'input-shortage-chain' });
              return { essential: essentialName, resource: req.res, kind: 'input-net-negative', severity: 'medium', why: `${req.res} draining (${days.toFixed(0)} days left)` };
            }
          }
        }
      }
      return null;
    },

    // v0.33: floating overlay UI ─────────────────────────────────────
    createUI() {
      const old = document.getElementById('legacybot-ui'); if (old) old.remove();
      const oldStyle = document.getElementById('legacybot-style'); if (oldStyle) oldStyle.remove();
      const style = document.createElement('style');
      style.id = 'legacybot-style';
      style.textContent = `
        #legacybot-ui{position:fixed;top:12px;right:12px;width:340px;background:rgba(20,22,28,0.92);color:#d4d4d8;border:1px solid #404048;border-radius:8px;font:12px/1.4 -apple-system,system-ui,sans-serif;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,0.4);backdrop-filter:blur(8px);max-height:90vh;overflow:hidden;display:flex;flex-direction:column}
        #legacybot-ui.collapsed{width:180px}
        #legacybot-ui.collapsed .lb-body{display:none}
        .lb-header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border-bottom:1px solid #404048;cursor:move;user-select:none;flex-shrink:0}
        .lb-title{font-weight:600;color:#fafafa}
        .lb-version{color:#71717a;font-size:10px;font-weight:400;margin-left:6px}
        .lb-btns{display:flex;gap:4px}
        .lb-iconbtn{background:transparent;color:#a1a1aa;border:1px solid #404048;border-radius:4px;width:22px;height:22px;cursor:pointer;padding:0;font-size:11px;line-height:1}
        .lb-iconbtn:hover{background:#404048;color:#fafafa}
        .lb-body{overflow-y:auto;flex:1}
        .lb-section{padding:10px 12px;border-bottom:1px solid #2a2a30}
        .lb-section h4{margin:0 0 6px 0;font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.05em}
        .lb-stats{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:11px}
        .lb-stats .label{color:#71717a}
        .lb-stats .val{color:#fafafa;font-variant-numeric:tabular-nums}
        .lb-stats .pos{color:#4ade80}
        .lb-stats .neg{color:#f87171}
        .lb-stats .warn{color:#fbbf24}
        .lb-toggle{display:flex;align-items:center;justify-content:space-between;padding:4px 0;font-size:11px}
        .lb-toggle label{color:#d4d4d8;cursor:pointer}
        .lb-toggle input{cursor:pointer}
        .lb-list{max-height:120px;overflow-y:auto;font-size:11px}
        .lb-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0}
        .lb-name{color:#d4d4d8;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .lb-num{color:#71717a;margin-right:6px;font-variant-numeric:tabular-nums}
        .lb-action{background:#2a2a30;color:#a1a1aa;border:1px solid #404048;border-radius:3px;padding:1px 6px;font-size:10px;cursor:pointer}
        .lb-action:hover{background:#404048;color:#fafafa}
        .lb-empty{color:#52525b;font-style:italic;font-size:11px}
        .lb-body::-webkit-scrollbar{width:6px}
        .lb-body::-webkit-scrollbar-track{background:transparent}
        .lb-body::-webkit-scrollbar-thumb{background:#404048;border-radius:3px}
        .lb-list::-webkit-scrollbar{width:4px}
        .lb-list::-webkit-scrollbar-thumb{background:#404048;border-radius:2px}
      `;
      document.head.appendChild(style);
      const ui = document.createElement('div');
      ui.id = 'legacybot-ui';
      ui.innerHTML = `
        <div class="lb-header" id="lb-header">
          <div><span class="lb-title">LegacyBot</span><span class="lb-version">v${Bot.version}</span></div>
          <div class="lb-btns">
            <button class="lb-iconbtn" id="lb-toggle-collapse" title="Collapse">−</button>
            <button class="lb-iconbtn" id="lb-stopstart" title="Stop/Start">⏸</button>
          </div>
        </div>
        <div class="lb-body">
          <div class="lb-section"><h4>Civilization</h4><div class="lb-stats" id="lb-stats"></div></div>
          <div class="lb-section"><h4>Bot Settings</h4><div id="lb-toggles"></div></div>
          <div class="lb-section"><h4>Essential Pyramids</h4><div class="lb-list" id="lb-pyramids" style="max-height:240px"></div><div id="lb-pyramid-expanded" style="margin-top:8px;font-family:monospace;font-size:10px;color:#a1a1aa;white-space:pre;overflow-x:auto;display:none;border-top:1px solid #2a2a30;padding-top:8px"></div></div>
          <div class="lb-section"><h4>Pinned <span style="color:#71717a;font-weight:400" id="lb-pins-count"></span></h4><div class="lb-list" id="lb-pins"></div></div>
          <div class="lb-section"><h4>You're managing <span style="color:#71717a;font-weight:400" id="lb-user-count"></span></h4><div class="lb-list" id="lb-user-list"></div></div>
          <div class="lb-section"><h4>Recent regressions</h4><div class="lb-list" id="lb-regression"></div></div>
        </div>
      `;
      document.body.appendChild(ui);
      const header = document.getElementById('lb-header');
      let dragOffX = 0, dragOffY = 0, dragging = false;
      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.lb-iconbtn')) return;
        dragging = true;
        const rect = ui.getBoundingClientRect();
        dragOffX = e.clientX - rect.left;
        dragOffY = e.clientY - rect.top;
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        ui.style.left = (e.clientX - dragOffX) + 'px';
        ui.style.top = (e.clientY - dragOffY) + 'px';
        ui.style.right = 'auto';
      });
      document.addEventListener('mouseup', () => dragging = false);
      document.getElementById('lb-toggle-collapse').addEventListener('click', () => {
        ui.classList.toggle('collapsed');
        document.getElementById('lb-toggle-collapse').textContent = ui.classList.contains('collapsed') ? '+' : '−';
      });
      document.getElementById('lb-stopstart').addEventListener('click', () => {
        if (Bot.timers.buy) { Bot.stop(); document.getElementById('lb-stopstart').textContent = '▶'; }
        else { Bot.start(); document.getElementById('lb-stopstart').textContent = '⏸'; }
      });
    },

    refreshUI() {
      if (!document.getElementById('legacybot-ui')) return;
      const r = G.resByName;
      const pop = (r.population && r.population.amount) || 0;
      const worker = (r.worker && r.worker.amount) || 0;
      const workerUsed = (r.worker && r.worker.used) || 0;
      const happy = (r.happiness && r.happiness.amount) || 0;
      const happyNet = r.happiness ? (r.happiness.gained - r.happiness.lost) : 0;
      const health = (r.health && r.health.amount) || 0;
      const healthNet = r.health ? (r.health.gained - r.health.lost) : 0;
      const food = (r.food && r.food.amount) || 0;
      const foodNet = r.food ? (r.food.gained - r.food.lost) : 0;
      const water = (r.water && r.water.amount) || 0;
      const waterNet = r.water ? (r.water.gained - r.water.lost) : 0;
      const fmt = (n) => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : Math.floor(n).toString();
      const fmtNet = (n) => (n >= 0 ? '+' : '') + n.toFixed(1) + '/t';
      const netCls = (n) => n > 0 ? 'pos' : n < 0 ? 'neg' : 'warn';
      const statsEl = document.getElementById('lb-stats');
      if (!statsEl) return;
      statsEl.innerHTML =
        `<div class="label">Year/Day</div><div class="val">${(G.year+1)} d${G.day}</div>` +
        `<div class="label">Population</div><div class="val">${fmt(pop)}</div>` +
        `<div class="label">Workers</div><div class="val">${fmt(workerUsed)} / ${fmt(worker)} <span class="${(worker-workerUsed)>1000?'warn':''}">(${fmt(worker-workerUsed)} idle)</span></div>` +
        `<div class="label">Happiness</div><div class="val">${fmt(happy)} <span class="${netCls(happyNet)}">${fmtNet(happyNet)}</span></div>` +
        `<div class="label">Health</div><div class="val">${Math.floor(health)} <span class="${netCls(healthNet)}">${fmtNet(healthNet)}</span></div>` +
        `<div class="label">Food</div><div class="val">${fmt(food)} <span class="${netCls(foodNet)}">${fmtNet(foodNet)}</span></div>` +
        `<div class="label">Water</div><div class="val">${fmt(water)} <span class="${netCls(waterNet)}">${fmtNet(waterNet)}</span></div>` +
        `<div class="label">Speed</div><div class="val">${G.getSetting('paused')?'⏸ paused':G.getSetting('fast')?'x30 fast':'1x normal'}</div>`;
      const toggles = [['autoBuy','Buy units/buildings'],['autoMode','Switch modes'],['autoResearch','Auto-research techs'],['autoTrait','Auto-acquire traits'],['autoPolicy','Auto-set policies'],['autoSpeed','Control game speed']];
      document.getElementById('lb-toggles').innerHTML = toggles.map(([k,label]) =>
        `<div class="lb-toggle"><label><input type="checkbox" data-toggle="${k}" ${Bot.settings[k]?'checked':''}> ${label}</label></div>`
      ).join('');
      document.querySelectorAll('[data-toggle]').forEach(el => {
        el.addEventListener('change', () => { Bot.settings[el.dataset.toggle] = el.checked; });
      });
      const pins = Object.entries(Bot.userPins);
      document.getElementById('lb-pins-count').textContent = pins.length ? `(${pins.length})` : '';
      document.getElementById('lb-pins').innerHTML = pins.length
        ? pins.map(([name, target]) => `<div class="lb-row"><span class="lb-name">${name}</span><span class="lb-num">${target}</span><button class="lb-action" data-unpin="${name}">unpin</button></div>`).join('')
        : '<div class="lb-empty">None pinned. Pin via LegacyBot.pin("X", N)</div>';
      document.querySelectorAll('[data-unpin]').forEach(el => {
        el.addEventListener('click', () => { Bot.unpin(el.dataset.unpin); Bot.refreshUI(); });
      });
      const uc = [...Bot._userControlled].filter(n => !Bot.userPins[n]);
      document.getElementById('lb-user-count').textContent = uc.length ? `(${uc.length})` : '';
      document.getElementById('lb-user-list').innerHTML = uc.length
        ? uc.map(name => {
            const insts = G.unitsOwned.filter(u => u.unit && u.unit.name === name);
            const amt = insts.reduce((s,i)=>s+i.amount,0);
            return `<div class="lb-row"><span class="lb-name">${name}</span><span class="lb-num">${amt}</span><button class="lb-action" data-release="${name}">release</button></div>`;
          }).join('')
        : '<div class="lb-empty">Nothing — bot manages everything</div>';
      document.querySelectorAll('[data-release]').forEach(el => {
        el.addEventListener('click', () => { Bot.release(el.dataset.release); Bot.refreshUI(); });
      });
      // v0.36: Essential Pyramids list
      const pyramidEl = document.getElementById('lb-pyramids');
      if (pyramidEl && Bot.essentialChains) {
        const bn = Bot._lastBottlenecks || {};
        pyramidEl.innerHTML = Bot.ESSENTIALS.map(ess => {
          const rs = G.resByName[ess];
          if (!rs) return '';
          const a = rs.amount || 0;
          const limit = rs.limit ? (G.resByName[rs.limit] && G.resByName[rs.limit].amount) : null;
          const net = (rs.gained || 0) - (rs.lost || 0);
          const netCls = net > 0 ? 'pos' : net < 0 ? 'neg' : 'warn';
          const cur = a >= 1e6 ? (a/1e6).toFixed(1)+'M' : a >= 1e3 ? (a/1e3).toFixed(1)+'k' : a.toFixed(0);
          const lim = limit !== null ? '/' + (limit >= 1e3 ? (limit/1e3).toFixed(1)+'k' : limit.toFixed(0)) : '';
          const bnInfo = bn[ess];
          const bnHTML = bnInfo
            ? `<span class="lb-num neg" title="${bnInfo.why}">⚠ ${bnInfo.resource}</span>`
            : `<span class="lb-num pos">ok</span>`;
          return `<div class="lb-row" data-pyramid="${ess}" style="cursor:pointer">
            <span class="lb-name">${ess}</span>
            <span class="lb-num">${cur}${lim} <span class="${netCls}">${net>=0?'+':''}${net.toFixed(1)}/t</span></span>
            ${bnHTML}
          </div>`;
        }).join('');
        document.querySelectorAll('[data-pyramid]').forEach(el => {
          el.addEventListener('click', () => {
            const ess = el.dataset.pyramid;
            const expEl = document.getElementById('lb-pyramid-expanded');
            if (!expEl) return;
            if (expEl.dataset.shown === ess) {
              expEl.style.display = 'none';
              delete expEl.dataset.shown;
              return;
            }
            expEl.dataset.shown = ess;
            expEl.style.display = 'block';
            expEl.textContent = Bot.renderPyramid(ess);
          });
        });
      }
      const reg = Bot.regression();
      document.getElementById('lb-regression').innerHTML = reg.length
        ? reg.map(r => `<div class="lb-row"><span class="lb-name">${r.metric}</span><span class="lb-num ${r.severity==='critical'?'neg':'warn'}">${r.deltaPct}%</span></div>`).join('')
        : '<div class="lb-empty">All metrics stable or improving</div>';
    },

    // v0.36: render an ASCII pyramid of the dependency chain for an essential.
    // Used by the expanded view in the UI when user clicks a pyramid row.
    renderPyramid(essentialName, depth = 0, visited = new Set()) {
      if (depth > 4 || visited.has(essentialName)) return '';
      visited.add(essentialName);
      const chain = Bot.essentialChains && Bot.essentialChains[essentialName];
      const bn = Bot._lastBottlenecks && Bot._lastBottlenecks[essentialName];
      const indent = '  '.repeat(depth);
      const res = G.resByName[essentialName];
      if (!res) return indent + essentialName + ' (missing)\n';
      const a = res.amount || 0;
      const limit = res.limit ? (G.resByName[res.limit] && G.resByName[res.limit].amount) : null;
      const fmt = (n) => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : Math.floor(n).toString();
      const net = (res.gained || 0) - (res.lost || 0);
      const bnMark = bn && bn.resource === essentialName ? ' <-- BOTTLENECK: '+(bn.why||'') : '';
      let lines = `${indent}${essentialName.toUpperCase()} ${fmt(a)}${limit!==null?'/'+fmt(limit):''} ${net>=0?'+':''}${net.toFixed(1)}/t${bnMark}\n`;
      if (!chain) return lines;
      // Cap providers
      if (chain.capProviders && chain.capProviders.length > 0 && depth < 3) {
        const owned = chain.capProviders.filter(p => p.unit || p.tech || p.trait);
        const ownedStr = owned.slice(0, 5).map(p => {
          if (p.tech) return `tech:${p.tech}(${p.rate})${p.owned?'✓':'?'}`;
          if (p.trait) return `trait:${p.trait}(${p.rate})${p.owned?'✓':'?'}`;
          if (p.unit) {
            const ins = G.unitsOwned.filter(u => u.unit && u.unit.name === p.unit).reduce((s,u)=>s+u.amount,0);
            return `${p.unit} x${ins}(${p.rate}/each)`;
          }
        }).join(', ');
        if (ownedStr) lines += `${indent}  caps: ${ownedStr}\n`;
      }
      // Flow producers
      if (chain.flowProducers) {
        for (const fp of chain.flowProducers.slice(0, 5)) {
          const ins = G.unitsOwned.filter(u => u.unit && u.unit.name === fp.unit);
          const totalAmt = ins.reduce((s,i)=>s+i.amount,0);
          const modeActive = !fp.mode || fp.mode === '__default__' || ins.some(i => i.mode && i.mode.id === fp.mode);
          const modeStr = fp.mode && fp.mode !== '__default__' ? `/${fp.mode}` : '';
          const status = totalAmt === 0 ? '[unbuilt]' : modeActive ? '[ok]' : '[mode inactive]';
          lines += `${indent}  ${fp.unit}${modeStr} x${totalAmt} ${status}\n`;
          // Show requires (only direct, no further recursion for clarity)
          if (depth < 2 && fp.requires) {
            for (const req of fp.requires.slice(0, 5)) {
              const rRes = G.resByName[req.res];
              if (!rRes) continue;
              const util = rRes.amount > 0 ? (rRes.used / rRes.amount * 100).toFixed(0) : '0';
              const reqStatus = rRes.used / Math.max(1, rRes.amount) > 0.9 ? '[saturated]' : '[ok]';
              lines += `${indent}    ${req.kind}: ${req.res} ${fmt(rRes.amount)}/${fmt(rRes.amount)} (${util}% used) ${reqStatus}\n`;
            }
          }
        }
      }
      return lines;
    },

    start() {
      Bot.catalog = buildCatalog();
      console.log('[Bot v' + Bot.version + '] catalog: ' + Object.keys(Bot.catalog).length + ' unit types');
      // v0.36: unhide capacity resources so user can see them in-game
      for (const k of ['wisdom','inspiration','spirituality','authority']) {
        const res = G.resByName[k];
        if (res) { res.hidden = false; res.visible = true; }
      }
      // v0.36: build the pyramid graph
      Bot.buildProducerMap();
      Bot.buildEssentialChains();
      console.log('[Bot v' + Bot.version + '] pyramid: ' + Object.keys(Bot.producerMap).length + ' resources mapped, ' + Object.keys(Bot.essentialChains).length + ' essential chains');
      if (Bot.timers.research) Bot.stop();
      Bot.stats.startedAt = Date.now();
      Bot.popHistory = [];
      // v0.18: seed _botSetTargets from current world state so existing queues
      // are recognized as the bot's own baseline, not as user input.
      const seed = {};
      for (const inst of G.unitsOwned) {
        if (!inst.unit) continue;
        seed[inst.unit.name] = (seed[inst.unit.name] || 0) + inst.targetAmount;
      }
      for (const name in seed) {
        if (Bot._userControlled.has(name) || Bot.userPins[name] !== undefined) continue;
        Bot._botSetTargets[name] = seed[name];
      }
      // v0.32: stamp every instance with current state so the bot treats the
      // existing world as its own baseline (not as user input).
      for (const inst of G.unitsOwned) Bot._stamp(inst);
      // v0.13: arrow-wrappers so late-binding picks up runtime reassignments to Bot.<method>.
      // Without this, hot-patching a method has no effect — setInterval captured the old reference.
      Bot.timers.research = setInterval(() => Bot.doResearchTick(), Bot.settings.researchInterval);
      Bot.timers.trait    = setInterval(() => Bot.doTraitTick(),    Bot.settings.researchInterval);
      Bot.timers.audit    = setInterval(() => Bot.snapshot(),       Bot.settings.auditInterval);
      Bot.timers.policy   = setInterval(() => Bot.doPolicyTick(),   Bot.settings.policyInterval);
      // v0.31: no speed timer — bot doesn't control game speed
      Bot.timers.buy      = setInterval(() => Bot.doBuyTick(),      Bot.settings.buyInterval);
      Bot.timers.mode     = setInterval(() => Bot.doModeTick(),     Bot.settings.modeInterval);
      // v0.33: floating overlay UI
      Bot.createUI();
      Bot.timers.ui = setInterval(() => Bot.refreshUI(), 1500);
      Bot.refreshUI();
      console.log('[Bot v' + Bot.version + '] started — tiered control loop');
    },
    stop() {
      for (const k in Bot.timers) if (Bot.timers[k]) { clearInterval(Bot.timers[k]); Bot.timers[k] = null; }
      console.log('[Bot] stopped');
    },
  };

  window.LegacyBot = Bot;
  Bot.start();
  Bot.status();
})();
