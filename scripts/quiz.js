// Quiz mode — διαδραστικὸ παιχνίδι ἀναγνωρίσεως ταξόν, τοπωνυμιῶν, ἐτυμολογίας.
// Loads all required JSON data, then drives a 10-question round of mixed game types.

const QUIZ_ROUND_SIZE = 10;
// Weighted by repetition. Trivia + riddle are the fun ones; relative + locality
// have small variation pools so we lean on them less.
const QUIZ_GAME_TYPES = [
  "silhouette",
  "locality",
  "period",
  "impostor",
  "relative", "relative",
  "riddle", "riddle", "riddle", "riddle", "riddle",
  "trivia", "trivia", "trivia", "trivia", "trivia", "trivia",
  "curiosity", "curiosity", "curiosity",
];

// Hand-curated curiosity facts per taxon, in three languages. Used by the
// "curiosity" game type. Each entry is a one-line "guess who I am" clue with
// a striking biological / historical / mythical detail. Keep them concise.
const CURIOSITIES = [
  {
    target: "spinosaurus",
    el: "Είμαι ο μόνος γνωστός δεινόσαυρος που πέρναγε τη ζωή του (σχεδόν) στο νερό.",
    en: "I'm the only dinosaur known to have lived a (mostly) aquatic lifestyle.",
    grc: "Μόνος εἰμὶ τῶν δεινοσαύρων ὅστις ἐν τοῖς ὕδασιν ἐβίωσεν.",
  },
  {
    target: "aves",
    el: "Είμαι η μοναδική ομάδα δεινοσαύρων που επέζησε της εξαφάνισης Κρητιδικού–Παλαιογενούς — με βλέπεις κάθε μέρα.",
    en: "I'm the only branch of dinosaurs that survived the K–Pg extinction; you see me every day.",
    grc: "Μόνη τῶν δεινοσαύρων διεσώθην ἐκ τῆς μεγάλης ἀφανίσεως· καθ' ἑκάστην ἡμέραν με ὁρᾷς.",
  },
  {
    target: "reedops",
    el: "Τα μάτια μου είχαν φακούς από καθαρό ασβεστίτη — βιολογικά οπτικά από κρύσταλλο.",
    en: "My eyes carried lenses made of pure calcite — biological optics built from crystal.",
    grc: "Οἱ ὀφθαλμοί μου φακοὺς ἐξ ἀσβεστίτου εἶχον, ὥσπερ ὑάλους ἐκ τῆς γῆς.",
  },
  {
    target: "trilobita",
    el: "Είχα τα πρώτα σύνθετα μάτια που διασώζονται σε απολίθωμα — τα αρχαιότερα ζωντανά «κάμερα» στην ιστορία.",
    en: "I had the earliest complex eyes preserved in the fossil record — life's oldest known cameras.",
    grc: "Τοὺς πρώτους συνθέτους ὀφθαλμοὺς ἔσχον ἐν τοῖς ἀπολιθώμασιν διασῳζομένους.",
  },
  {
    target: "gryphaea",
    el: "Το γαμψό μου σχήμα μου χάρισε το λαϊκό όνομα «νύχια του διαβόλου».",
    en: "My curled shape earned me the folk name \"devil's toenails\".",
    grc: "Διὰ τὸ κυρτὸν σχῆμά μου ἐκαλούμην «τοῦ διαβόλου ὄνυχες».",
  },
  {
    target: "lepisosteus",
    el: "Είμαι «ζωντανό απολίθωμα» — η οικογένειά μου μοιάζει σχεδόν ίδια εδώ και 100 εκατομμύρια χρόνια.",
    en: "I'm a \"living fossil\" — my lineage looks almost the same as it did 100 million years ago.",
    grc: "Ζῷον ἀρχαῖον εἰμί· ἐπὶ ἑκατὸν μυριάδας ἐτῶν τὸ γένος μου οὐ πολὺ μετήλλαξεν.",
  },
  {
    target: "diplocynodon",
    el: "Ήμουν μικρός αλιγάτορας που κολυμπούσε στους ευρωπαϊκούς βάλτους του Ηωκαίνου.",
    en: "I was a small alligator paddling through the Eocene swamps of Europe.",
    grc: "Μικρὸς ἀλιγάτωρ ἤμην ἐν τοῖς εὐρωπαϊκοῖς ἕλεσι τοῦ Ἠωκαίνου.",
  },
  {
    target: "belemnitida",
    el: "Τα βελοειδή απολιθώματά μου τα ονόμαζαν στη λαϊκή παράδοση «αστροπελέκια» — δώρα του Δία.",
    en: "My dart-shaped fossils were called \"thunderstones\" in folklore — gifts of Zeus.",
    grc: "Τὰ βελοειδῆ ὀστρᾶ μου «κεραυνοὶ» ἐκαλοῦντο τοῖς ἀρχαίοις, δῶρα τοῦ Διός.",
  },
  {
    target: "ammonoidea",
    el: "Τα σπειρωτά μου όστρακα ενέπνευσαν τη μεσαιωνική πεποίθηση των «λίθων-φιδιών».",
    en: "My coiled shells inspired the medieval belief in \"snakestones\".",
    grc: "Τὰ ἑλικοειδῆ ὄστρακά μου τοὺς μεσαιωνικοὺς εἰς τὴν τῶν «ὄφεων λίθων» δόξαν ὁδήγησαν.",
  },
  {
    target: "trionychidae",
    el: "Σε αντίθεση με άλλες χελώνες, το κέλυφός μου είναι μαλακό, καλυμμένο με δέρμα, όχι κερατώδεις πλάκες.",
    en: "Unlike other turtles, my shell is soft and leathery — skin instead of bony scutes.",
    grc: "Παρὰ τὰς ἄλλας χελώνας, τὸ χέλυόν μου μαλακὸν καὶ δερμάτινον, οὐ κερατῶδες.",
  },
  {
    target: "inoceramidae",
    el: "Μερικά είδη μου ανέπτυσσαν όστρακα πλάτους πάνω από ένα μέτρο — γίγαντες των διθύρων.",
    en: "Some of my species grew shells over a metre across — bivalve giants of their day.",
    grc: "Τινὰ τοῦ γένους μου ὄστρακα πλείω τοῦ μέτρου ἐποίει· γίγαντες τῶν διθύρων.",
  },
  {
    target: "argonautidae",
    el: "Η θηλυκή κατασκευάζει μόνη της ένα όστρακο σαν χαρτί για τα αυγά της — μοναδικό χταπόδι με αυτή τη συμπεριφορά.",
    en: "The female crafts herself a paper-thin shell to brood her eggs — the only octopus that does.",
    grc: "Ἡ θήλεια ὄστρακον λεπτὸν ὥσπερ χάρτην δι' ἑαυτῆς πλάττει τοῖς ᾠοῖς· μόνη τῶν ὀκταποδῶν.",
  },
  {
    target: "theodoxus",
    el: "Το όστρακό μου του γλυκού νερού φέρει σχέδια ζιγκ-ζαγκ μοναδικά σαν δαχτυλικά αποτυπώματα.",
    en: "My freshwater shell sports zigzag patterns as unique as fingerprints.",
    grc: "Τὸ ὄστρακόν μου ἐκ τῶν γλυκέων ὑδάτων σχέδια ζιγκ-ζάγ φέρει, ὥσπερ δακτυλικὰ σημεῖα.",
  },
  {
    target: "chondrichthyes",
    el: "Ο σκελετός μου είναι από χόνδρο, όχι κόκαλο, και τα δόντια μου αντικαθίστανται σ' όλη μου τη ζωή.",
    en: "My skeleton is made of cartilage, not bone — and my teeth keep replacing themselves throughout my life.",
    grc: "Ὁ σκελετός μου ἐκ χονδροῦ ἐστιν, οὐκ ἐκ ὀστοῦν· καὶ οἱ ὀδόντες μου ἀντικαθίστανται διὰ βίου.",
  },
  {
    target: "phacopida",
    el: "Είχα μίσχωτα σύνθετα μάτια — και μπορούσα να τυλιχτώ σε μπάλα για να αμυνθώ.",
    en: "I bore stalked, scallop-like compound eyes — and could curl into a ball for defence.",
    grc: "Ὀφθαλμοὺς ποδιαίους εἶχον· καὶ εἰς σφαῖραν ἐτυλιγόμην ὅταν ἐδεδιόμην.",
  },
  {
    target: "heterobrissus",
    el: "Το απολιθωμένο σχήμα μου μοιάζει με καρδιά — σκάβω στον βυθό για να τραφώ.",
    en: "My fossil shape resembles a heart — I burrow through seafloor sediment to feed.",
    grc: "Τὸ ἀπολιθωμένον σχῆμά μου καρδιοειδές· ἐν τῷ βυθῷ ὀρύσσω εἰς τροφήν.",
  },
  {
    target: "siphonodendron",
    el: "Ήμουν αποικιακό κοράλλι με παράλληλους πολυποδικούς σωλήνες — εξαφανίστηκα στο τέλος του Παλαιοζωικού.",
    en: "I was a colonial coral of parallel polyp-tubes — extinct since the close of the Paleozoic.",
    grc: "Ἀποικιακὸν κοράλλιον ἤμην μετὰ παραλλήλων σωληνῶν· ἀπεσβέσθην ἐν τέλει τοῦ Παλαιοζωικοῦ.",
  },
  {
    target: "scyphocrinites_elegans",
    el: "Ήμουν θαλάσσιο κρίνο που επέπλεε στις ύστερες θάλασσες του Σιλούριου, κρατώντας τον εαυτό μου σε ένα αερόσφαιρα.",
    en: "I was a sea lily that floated in late Silurian seas, suspended by a balloon-like float.",
    grc: "Θαλάσσιον κρίνον ἤμην ἐπιπλέον ἐν τῷ ὑστέρῳ Σιλουρίῳ, κρεμάμενον ἐκ σφαίρας τινός ἀέρος πλήρους.",
  },
  {
    target: "mollusca",
    el: "Περιλαμβάνω το μεγαλύτερο γνωστό ασπόνδυλο: το κολοσσιαίο καλαμάρι ζυγίζει πάνω από 500 κιλά.",
    en: "I include the largest invertebrate ever known — the colossal squid weighs over 500 kg.",
    grc: "Συμπεριλαμβάνω τὸ μέγιστον τῶν γνωστῶν ἀσπονδύλων· τὸ κολοσσιαῖον τευθὸν πλείω τῶν φʹ μνῶν ἕλκει.",
  },
  {
    target: "animalia",
    el: "Περιλαμβάνω πάνω από 1,5 εκατομμύρια καταγεγραμμένα είδη — και πιθανώς πολλές φορές περισσότερα ακαταγράφητα.",
    en: "I include over 1.5 million described species — and likely many times more still uncatalogued.",
    grc: "Συμπεριλαμβάνω πλείω ἢ ͵αψπεντακοσίων μυριάδων εἰδῶν ἐπιγεγραμμένων, καὶ πλείω ἀκαταλογήτων.",
  },
  {
    target: "pinnidae",
    el: "Από τον βύσσο μου ύφαιναν στην αρχαιότητα «θαλάσσιο μετάξι» — χρυσαφί κλωστές που ίσως ενέπνευσαν τον μύθο του Χρυσόμαλλου Δέρατος.",
    en: "From my byssus the ancients wove \"sea silk\" — golden threads that may have inspired the myth of the Golden Fleece.",
    grc: "Ἐκ τοῦ βύσσου μου οἱ πάλαι «θαλάσσιον μέταξι» ὕφαινον· χρυσᾶ νήματα, ἃ ἴσως τὸν τοῦ χρυσομάλλου δέρατος μῦθον ἐνέπνευσαν.",
  },
  {
    target: "mytilidae",
    el: "Κολλάω σε βράχια κάτω από το νερό — τα νήματά μου εμπνέουν τις σύγχρονες ιατρικές κόλλες.",
    en: "I cling to rocks underwater — and my anchoring threads inspire today's medical adhesives.",
    grc: "Ταῖς πέτραις ἐν τῷ ὕδατι προσκολλῶμαι· τὰ δὲ νήματά μου τὰς νῦν ἰατρικὰς κόλλας ἐμπνέουσιν.",
  },
];

// Playful sentence-form templates for riddles. Each template lists the facts
// it depends on; the question builder picks one where every required fact is
// available for the target. Filler tokens `{period}` etc. are substituted at
// render time so language switching re-flows the prose naturally.
// Templates use only nominative-friendly constructions: neuter-plural taxa
// (Μαλάκια, Χορδωτά, etc.) and neuter-singular periods (Ιουρασικό) drop into
// accusative or predicative slots without breaking. Country values use the
// pre-localized "country-in-{code}" dict keys ("στην Αγγλία", "in England",
// "ἐν Ἀγγλίᾳ") to handle the gender/case variation per country.
//
// Period claims are deliberately framed as "fossils dated to" / "specimens
// found in" rather than "I rose in / I lived in" — for higher-rank taxa, a
// sample's period only dates *that fossil*, not the taxon's full range.
const RIDDLE_TEMPLATES = [
  {
    needs: ["meaning", "period_in"],
    el: "Δείγματά μου βρέθηκαν {period_in}, και το όνομά μου ψιθυρίζει «{meaning}». Ποιος είμαι;",
    en: "My fossils turned up {period_in}, and my name whispers \"{meaning}\". Who am I?",
    grc: "Δείγματά μου εὑρέθησαν {period_in}, καὶ τοὔνομά μου ψιθυρίζει «{meaning}». Τίς εἰμί;",
  },
  {
    needs: ["meaning", "country_in"],
    el: "Με βρήκαν {country_in}, και το όνομά μου σημαίνει «{meaning}». Ποιος είμαι;",
    en: "I was unearthed {country_in}; my name means \"{meaning}\". Who am I?",
    grc: "Εὑρέθην {country_in}, καὶ τοὔνομά μου σημαίνει «{meaning}». Τίς εἰμί;",
  },
  {
    needs: ["meaning", "phylum"],
    el: "Ανήκω στα {phylum}, και το όνομά μου τραγουδά «{meaning}». Ποιος είμαι;",
    en: "I belong to the {phylum}; my name sings of \"{meaning}\". Who am I?",
    grc: "Φῦλον ἐμόν τὰ {phylum}, καὶ τοὔνομά μου ᾄδει «{meaning}». Τίς εἰμί;",
  },
  {
    needs: ["country_in", "phylum", "meaning"],
    el: "Με βρήκαν {country_in}, ανήκω στα {phylum}, και το όνομά μου σημαίνει «{meaning}». Ποιος είμαι;",
    en: "Found {country_in}, kin to the {phylum}; my name means \"{meaning}\". Who am I?",
    grc: "Εὑρέθην {country_in}· φῦλον ἐμόν τὰ {phylum}· τοὔνομά μου σημαίνει «{meaning}». Τίς εἰμί;",
  },
  // Dramatic variant — emphasizes the etymological echo
  {
    needs: ["meaning", "period_in"],
    el: "Άκου προσεκτικά: το όνομά μου κρύβει «{meaning}», και τα κόκαλά μου ξύπνησαν {period_in}. Ποιος είμαι;",
    en: "Listen close — my name hides \"{meaning}\", and my bones woke {period_in}. Who am I?",
    grc: "Ἄκουε· τοὔνομά μου κρύπτει «{meaning}»· τὰ ὀστᾶ μου ἀνέστησαν {period_in}. Τίς εἰμί;",
  },
  // Pure etymology — cryptic clue style, the user has to decode the meaning
  {
    needs: ["meaning"],
    el: "Το όνομά μου κρύβει τα Ελληνικά για «{meaning}». Ποιος είμαι;",
    en: "My name hides the Greek for \"{meaning}\". Who am I?",
    grc: "Τοὔνομά μου κρύπτει τὸ ἑλληνικὸν περὶ «{meaning}». Τίς εἰμί;",
  },
  {
    needs: ["meaning"],
    el: "Διηγηθεῖτε το όνομά μου: σημαίνει «{meaning}». Μάντεψέ με!",
    en: "Tell my name aloud — it means \"{meaning}\". Guess me!",
    grc: "Διηγηθήτω τοὔνομα ἐμόν· σημαίνει «{meaning}». Μάντευσόν με.",
  },
  {
    needs: ["meaning", "rank"],
    el: "{rank} με όνομα ποιητικό: σημαίνει «{meaning}». Ποιος είμαι;",
    en: "A {rank} with a poetic name — it means \"{meaning}\". Who am I?",
    grc: "{rank} ὄνομα ἔχων ποιητικόν· σημαίνει «{meaning}». Τίς εἰμί;",
  },
];

// Periods that are too broad / unknown to use as quiz answers.
const QUIZ_PERIOD_BLOCKLIST = new Set(["phanerozoic", "άγνωστο"]);

const _SUBDIVISION_FLAGS = {
  en: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
  sc: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
  wl: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}",
};

function countryFlagEmoji(code) {
  if (!code) return "";
  const c = code.toLowerCase();
  if (_SUBDIVISION_FLAGS[c]) return _SUBDIVISION_FLAGS[c];
  if (c.length !== 2) return "";
  const A = 0x1F1E6;
  return String.fromCodePoint(A + c.charCodeAt(0) - 97) +
         String.fromCodePoint(A + c.charCodeAt(1) - 97);
}

const QuizState = {
  data: null,
  ancestorsMap: null,
  taxaIndex: null,
  taxaWithAi: null,
  taxaWithEtymology: null,
  samplesByTaxon: null,
  validSamplesForLocality: null,
  validSamplesForPeriod: null,
  round: null,
  current: null,
};

async function quizLoadData() {
  const base = getBaseURL();
  const [taxonomy, geochronology, samples, phylopic] = await Promise.all([
    fetch(base + "/jsondata/taxonomy.json").then(r => r.json()),
    fetch(base + "/jsondata/geochronology.json").then(r => r.json()),
    fetch(base + "/jsondata/samples_info.json").then(r => r.json()),
    fetch(base + "/jsondata/phylopic_cache.json").then(r => r.json()),
  ]);
  QuizState.data = { taxonomy, geochronology, samples, phylopic };
  buildQuizIndices();
}

function buildQuizIndices() {
  const taxaIndex = {};

  function walk(tree, ancestors) {
    for (const [key, node] of Object.entries(tree)) {
      if (!node || typeof node !== "object" || !node.rank) continue;
      const chain = ancestors.concat(key);
      taxaIndex[key] = {
        key,
        rank: node.rank,
        name: node.name || {},
        description: node.description || {},
        ancestors: chain,
      };
      if (node.subtaxa && typeof node.subtaxa === "object") {
        walk(node.subtaxa, chain);
      }
    }
  }
  walk(QuizState.data.taxonomy, []);

  QuizState.taxaIndex = taxaIndex;
  QuizState.ancestorsMap = {};
  for (const [k, v] of Object.entries(taxaIndex)) {
    QuizState.ancestorsMap[k] = v.ancestors;
  }

  // Which taxa have an AI thumbnail (filename = capitalised el name + .jpg).
  // We can't probe the filesystem from JS, so we trust that every taxon with
  // a non-empty el name has one (verified at build: 83/83). Build a Set for symmetry.
  QuizState.taxaWithAi = new Set(
    Object.keys(taxaIndex).filter(k => taxaIndex[k].name && taxaIndex[k].name.el)
  );

  // Index samples by their direct taxon and by all ancestors (for riddle pool).
  const samplesByTaxon = {};
  for (const [sid, sample] of Object.entries(QuizState.data.samples)) {
    const lt = sample.lowest_taxa;
    if (!lt || !taxaIndex[lt]) continue;
    const ancestors = taxaIndex[lt].ancestors;
    for (const a of ancestors) {
      (samplesByTaxon[a] = samplesByTaxon[a] || []).push(sid);
    }
  }
  QuizState.samplesByTaxon = samplesByTaxon;

  const localities = QuizState.data.geochronology.localities || {};
  QuizState.validSamplesForLocality = Object.entries(QuizState.data.samples)
    .filter(([sid, s]) => {
      const loc = localities[s.locality];
      return loc && loc.country && s.images && s.images.length > 0;
    })
    .map(([sid]) => sid);

  QuizState.validSamplesForPeriod = Object.entries(QuizState.data.samples)
    .filter(([sid, s]) => {
      const loc = localities[s.locality];
      const period = loc && loc.age && loc.age.period;
      return period && !QUIZ_PERIOD_BLOCKLIST.has(period) &&
             s.images && s.images.length > 0;
    })
    .map(([sid]) => sid);
}

// ---------- Helpers ----------

function lcaDepth(a, b) {
  const ca = QuizState.ancestorsMap[a] || [];
  const cb = QuizState.ancestorsMap[b] || [];
  let n = 0;
  while (n < ca.length && n < cb.length && ca[n] === cb[n]) n++;
  return n;
}

function sharedPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// Two taxa share a name "stem" if any of their multilingual names (or keys)
// share a 5+ character prefix. Used to prevent trivial give-away distractors
// like Cardinia / Cardiniidae appearing together as quiz options.
function namesShareStem(a, b, threshold = 5) {
  if (!a || !b || a === b) return false;
  const tA = QuizState.taxaIndex[a];
  const tB = QuizState.taxaIndex[b];
  if (!tA || !tB) return false;
  if (sharedPrefixLen(a.toLowerCase(), b.toLowerCase()) >= threshold) return true;
  for (const lang of ["el", "en", "grc"]) {
    const na = (tA.name?.[lang] || "").toLowerCase();
    const nb = (tB.name?.[lang] || "").toLowerCase();
    if (na && nb && sharedPrefixLen(na, nb) >= threshold) return true;
  }
  return false;
}

// For description/etymology display: strip taxon-name references that would
// give away the answer. Removes the target's own names, names of any taxon
// whose name shares a stem with the target, and (in non-English) any leftover
// Latin-script word.
// Normalise a word for forgiving comparison: strip diacritics, lowercase,
// collapse ω↔ο / η↔ε / υ↔ι (common Greek orthographic variations between
// "τριωνυχίδαι" and "Τριονυχίδαι" etc).
function normalizeGreek(s) {
  if (!s) return "";
  return s.normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ω/g, "ο")
    .replace(/η/g, "ε")
    .replace(/υ/g, "ι");
}

function sanitizeText(text, target, lang) {
  if (!text) return "";
  let out = text;
  const stripWords = new Set();
  const targetEntry = QuizState.taxaIndex[target];
  const dictNames = [];
  if (targetEntry) {
    for (const n of Object.values(targetEntry.name || {})) {
      if (n) {
        stripWords.add(n);
        dictNames.push(n);
      }
    }
    for (const [k, t] of Object.entries(QuizState.taxaIndex)) {
      if (k === target) continue;
      if (namesShareStem(target, k)) {
        for (const n of Object.values(t.name || {})) {
          if (n) stripWords.add(n);
        }
      }
    }
    // Pick up taxon-name variants from the description: capitalised words whose
    // normalised 4-char stem matches a dict-name's normalised stem. Catches
    // orthographic variants ("Τριονυχίδαι" vs dict "τριωνυχίδαι") without
    // sweeping in unrelated capitalised words like "Mandibulata" or "Unlike".
    const dictStems4 = dictNames
      .map(n => normalizeGreek(n).slice(0, 4))
      .filter(s => s.length === 4);
    for (const langDesc of Object.values(targetEntry.description || {})) {
      if (!Array.isArray(langDesc) || !langDesc.length) continue;
      const firstSentence = langDesc[0] || "";
      const caps = firstSentence.match(/[\p{Lu}][\p{L}]{4,}/gu) || [];
      for (const cap of caps) {
        const capStem = normalizeGreek(cap).slice(0, 4);
        if (dictStems4.includes(capStem)) stripWords.add(cap);
      }
    }
  }
  for (const word of stripWords) {
    if (word.length < 3) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), "[...]");
  }
  // Forgiving prefix-match: replace any word sharing 6+ normalised characters
  // with a dict-name. Catches "trilobites" ≡ "trilobita" (8 shared) and
  // "Τριονυχίδαι" ≡ "τριωνυχίδαι" without touching unrelated words like
  // "Unlike" or "οδοντοφυΐα" (whose common prefix with any dict-name is < 6).
  const dictNorms = dictNames.map(normalizeGreek).filter(s => s.length >= 6);
  if (dictNorms.length) {
    out = out.replace(/[\p{L}]+/gu, (word) => {
      if (word.length < 6) return word;
      const wn = normalizeGreek(word);
      for (const d of dictNorms) {
        let common = 0;
        while (common < wn.length && common < d.length && wn[common] === d[common]) common++;
        if (common >= 6) return "[...]";
      }
      return word;
    });
  }
  // In non-English, additionally redact any remaining Latin-script word
  // (likely a scientific binomial polluting the localized text).
  if (lang !== "en") {
    out = out.replace(/(?<![A-Za-z])[A-Za-z]{4,}(?![A-Za-z])/g, "[...]");
  }
  out = out.replace(/(\[\.\.\.\][\s,;:.\-—]*){2,}/g, "[...] ");
  return out;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getLang() {
  return document.documentElement.lang || getLanguage();
}

function tr(key, lang) {
  lang = lang || getLang();
  if (globalDict && globalDict[lang] && key in globalDict[lang]) {
    return globalDict[lang][key];
  }
  return key;
}

function getTaxonDisplayName(key, lang) {
  lang = lang || getLang();
  const t = QuizState.taxaIndex[key];
  if (t && t.name && t.name[lang]) {
    return t.name[lang].charAt(0).toUpperCase() + t.name[lang].slice(1);
  }
  return tr(key, lang);
}

function getCountryDisplayName(code, lang) {
  return tr(code, lang);
}

function getPeriodDisplayName(period, lang) {
  return tr(period, lang);
}

function getAiThumbUrl(taxonKey) {
  const elName = QuizState.taxaIndex[taxonKey]?.name?.el;
  if (!elName) return null;
  const cap = elName.charAt(0).toUpperCase() + elName.slice(1);
  return getBaseURL() + "/images/thumbnails/" + encodeURIComponent(cap) + ".jpg";
}

function getSampleImageUrl(sample) {
  if (!sample.images || !sample.images.length) return null;
  const img = sample.images[0];
  return getBaseURL() + "/" + sample.images_dir + "/" + encodeURIComponent(img.filename) + ".jpg";
}

function getPhyloPicUrl(taxonKey) {
  const entry = QuizState.data.phylopic[taxonKey];
  return entry && entry.vector_url ? entry.vector_url : null;
}

// ---------- Question builders ----------
// Each returns { type, prompt: i18nKey, mediaHtml, choices: [{key, label, isCorrect}], hintMax, render(stage), explanation }
// or null if construction failed and a different type should be tried.

function buildSilhouetteQuestion(excludeTaxa) {
  const pool = Object.keys(QuizState.data.phylopic)
    .filter(k => QuizState.data.phylopic[k].vector_url)
    .filter(k => !excludeTaxa.has(k));
  if (pool.length < 4) return null;
  const target = pickOne(pool);
  const targetChain = QuizState.ancestorsMap[target] || [];
  const targetPhylum = targetChain[1];
  const distractorPool = pool.filter(k =>
    k !== target && (QuizState.ancestorsMap[k] || [])[1] !== targetPhylum
  );
  if (distractorPool.length < 3) return null;
  const distractors = shuffle(distractorPool).slice(0, 3);
  const choices = shuffle(
    [target, ...distractors].map(k => ({
      key: k,
      isCorrect: k === target,
    }))
  );
  return {
    type: "silhouette",
    target,
    promptKey: "quiz-prompt-silhouette",
    media: { kind: "silhouette", url: getPhyloPicUrl(target) },
    choices,
    hintMax: 0,
    hintsUsed: 0,
    choiceLabeller: (k, lang) => getTaxonDisplayName(k, lang),
  };
}

function buildLocalityQuestion(excludeTaxa) {
  const pool = QuizState.validSamplesForLocality;
  if (pool.length < 4) return null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const sid = pickOne(pool);
    const sample = QuizState.data.samples[sid];
    if (sample.lowest_taxa && excludeTaxa.has(sample.lowest_taxa)) continue;
    const locality = QuizState.data.geochronology.localities[sample.locality];
    const correctCountry = locality.country;
    const allCountries = Array.from(new Set(
      Object.values(QuizState.data.geochronology.localities)
        .map(l => l.country)
        .filter(Boolean)
    ));
    const distractors = shuffle(allCountries.filter(c => c !== correctCountry));
    if (distractors.length < 3) return null;
    const choices = shuffle(
      [correctCountry, ...distractors.slice(0, 3)].map(c => ({
        key: c,
        isCorrect: c === correctCountry,
      }))
    );
    return {
      type: "locality",
      target: sample.lowest_taxa,
      sampleId: sid,
      promptKey: "quiz-prompt-locality",
      media: { kind: "photo", url: getSampleImageUrl(sample) },
      choices,
      hintMax: 0,
      hintsUsed: 0,
      choiceLabeller: (k, lang) => countryFlagEmoji(k) + " " + getCountryDisplayName(k, lang),
    };
  }
  return null;
}

function buildPeriodQuestion(excludeTaxa) {
  const pool = QuizState.validSamplesForPeriod;
  if (pool.length < 4) return null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const sid = pickOne(pool);
    const sample = QuizState.data.samples[sid];
    if (sample.lowest_taxa && excludeTaxa.has(sample.lowest_taxa)) continue;
    const locality = QuizState.data.geochronology.localities[sample.locality];
    const correctPeriod = locality.age.period;
    const allPeriods = Array.from(new Set(
      Object.values(QuizState.data.geochronology.localities)
        .map(l => l.age && l.age.period)
        .filter(p => p && !QUIZ_PERIOD_BLOCKLIST.has(p))
    ));
    const distractors = shuffle(allPeriods.filter(p => p !== correctPeriod));
    if (distractors.length < 3) return null;
    const choices = shuffle(
      [correctPeriod, ...distractors.slice(0, 3)].map(p => ({
        key: p,
        isCorrect: p === correctPeriod,
      }))
    );
    return {
      type: "period",
      target: sample.lowest_taxa,
      sampleId: sid,
      promptKey: "quiz-prompt-period",
      media: { kind: "photo", url: getSampleImageUrl(sample) },
      choices,
      hintMax: 0,
      hintsUsed: 0,
      choiceLabeller: (k, lang) => getPeriodDisplayName(k, lang),
    };
  }
  return null;
}

function buildImpostorQuestion(excludeTaxa) {
  // Pick a phylum that has ≥3 taxa with AI thumbnails.
  const taxaByPhylum = {};
  for (const k of QuizState.taxaWithAi) {
    if (excludeTaxa.has(k)) continue;
    const phylum = (QuizState.ancestorsMap[k] || [])[1];
    if (!phylum) continue;
    (taxaByPhylum[phylum] = taxaByPhylum[phylum] || []).push(k);
  }
  const phyla = Object.keys(taxaByPhylum).filter(p => taxaByPhylum[p].length >= 3);
  if (phyla.length < 2) return null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const hostPhylum = pickOne(phyla);
    const insiders = shuffle(taxaByPhylum[hostPhylum]).slice(0, 3);
    // Skip if insiders share stems with each other (gives away the group).
    const insidersOk = insiders.every((a, i) =>
      insiders.every((b, j) => i === j || !namesShareStem(a, b))
    );
    if (!insidersOk) continue;
    const outsiderPool = Object.keys(taxaByPhylum)
      .filter(p => p !== hostPhylum)
      .flatMap(p => taxaByPhylum[p])
      .filter(k => insiders.every(ins => !namesShareStem(ins, k)));
    if (outsiderPool.length === 0) continue;
    const outsider = pickOne(outsiderPool);
    const choices = shuffle(
      [...insiders, outsider].map(k => ({ key: k, isCorrect: k === outsider }))
    );
    return {
      type: "impostor",
      target: outsider,
      promptKey: "quiz-prompt-impostor",
      media: null,
      choices,
      hintMax: 0,
      hintsUsed: 0,
      choiceLabeller: (k, lang) => getTaxonDisplayName(k, lang),
      choiceMedia: k => ({ kind: "ai", url: getAiThumbUrl(k) }),
    };
  }
  return null;
}

function buildRelativeQuestion(excludeTaxa) {
  // Sorting variant: present 3 taxa at distinct phylogenetic distances and
  // ask the user to order them from closest to most distant relative.
  const pool = Array.from(QuizState.taxaWithAi).filter(k => !excludeTaxa.has(k));
  if (pool.length < 5) return null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const target = pickOne(pool);
    const targetChain = QuizState.ancestorsMap[target] || [];
    if (targetChain.length < 3) continue;
    const ancestorsOfTarget = new Set(targetChain);
    const descendants = new Set(
      Object.keys(QuizState.ancestorsMap)
        .filter(k => (QuizState.ancestorsMap[k] || []).includes(target) && k !== target)
    );
    const candidates = pool
      .filter(k => k !== target && !ancestorsOfTarget.has(k) && !descendants.has(k))
      .filter(k => !namesShareStem(target, k))
      .map(k => ({ key: k, depth: lcaDepth(target, k) }))
      .filter(x => x.depth > 0);
    // Bucket by depth — we want 3 candidates from 3 distinct depths so the
    // ordering has unambiguous gaps.
    const byDepth = new Map();
    for (const c of candidates) {
      if (!byDepth.has(c.depth)) byDepth.set(c.depth, []);
      byDepth.get(c.depth).push(c);
    }
    const distinctDepths = [...byDepth.keys()].sort((a, b) => b - a);
    if (distinctDepths.length < 3) continue;
    const chosenDepths = distinctDepths.slice(0, 3);
    const picks = chosenDepths.map(d => pickOne(byDepth.get(d)));
    // Correct order: deepest LCA first (closest relative first).
    const correctOrder = picks.map(p => p.key);
    const shuffled = shuffle(picks);
    return {
      type: "relative",
      target,
      promptKey: "quiz-prompt-relative",
      media: { kind: "ai", url: getAiThumbUrl(target) },
      mediaCaption: () => getTaxonDisplayName(target),
      choices: shuffled.map(p => ({ key: p.key, depth: p.depth })),
      correctOrder,
      hintMax: 0,
      hintsUsed: 0,
      isSort: true,
      choiceLabeller: (k, lang) => getTaxonDisplayName(k, lang),
    };
  }
  return null;
}

function factAppliesTo(fact, taxonKey) {
  if (!fact || !taxonKey) return false;
  if (fact.valueKind === "literal") {
    const meaning = extractEtymologyMeaning(taxonKey, getLang()) || extractEtymologyMeaning(taxonKey, "en");
    return meaning === fact.value;
  }
  if (fact.valueKind === "literal_lang") {
    // Language-specific meaning bundle — match against EN by default since
    // that's the most reliable source.
    const meaning = extractEtymologyMeaning(taxonKey, "en");
    return meaning && meaning === fact.value.en;
  }
  if (fact.valueKind === "period" || fact.valueKind === "period_in") {
    const sampleIds = QuizState.samplesByTaxon[taxonKey] || [];
    return sampleIds.some(sid => {
      const loc = QuizState.data.geochronology.localities[QuizState.data.samples[sid].locality];
      return loc && loc.age && loc.age.period === fact.value;
    });
  }
  if (fact.valueKind === "country" || fact.valueKind === "country_in") {
    const sampleIds = QuizState.samplesByTaxon[taxonKey] || [];
    return sampleIds.some(sid => {
      const loc = QuizState.data.geochronology.localities[QuizState.data.samples[sid].locality];
      return loc && loc.country === fact.value;
    });
  }
  if (fact.valueKind === "taxon") {
    return (QuizState.ancestorsMap[taxonKey] || []).includes(fact.value);
  }
  if (fact.valueKind === "rank") {
    return QuizState.taxaIndex[taxonKey]?.rank === fact.value;
  }
  return false;
}

// Extract a short "meaning" snippet from an etymology paragraph.
// Looks for quoted phrases — Greek, Latin or English etymology entries
// typically gloss the roots like ("hinge"), («σπίνη»), ('spine') etc.
function extractEtymologyMeaning(taxonKey, lang) {
  const ety = QuizState.taxaIndex[taxonKey]?.etymology?.[lang];
  if (!ety || !ety.length) return null;
  const text = ety[0];
  // Capture content inside common quote pairs.
  const re = /(?:[«"'"„]([^«»"'""„'']{2,40})[»"'""'"]|\(([^()]{2,40})\))/g;
  const meanings = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const phrase = (m[1] || m[2] || "").trim();
    if (!phrase) continue;
    // Skip parentheticals that contain Latin/scientific words (likely refs to other taxa)
    if (/[A-Z][a-z]{4,}/.test(phrase)) continue;
    // Skip if the phrase contains the target name's stem
    const targetNames = Object.values(QuizState.taxaIndex[taxonKey]?.name || {});
    if (targetNames.some(n => {
      const stem = n.toLowerCase().slice(0, 5);
      return stem && phrase.toLowerCase().includes(stem);
    })) continue;
    meanings.push(phrase);
    if (meanings.length >= 3) break;
  }
  if (!meanings.length) return null;
  return meanings.join(", ");
}

function collectFactsFor(target, lang) {
  const facts = {};
  const chain = QuizState.ancestorsMap[target] || [];
  const sampleIds = QuizState.samplesByTaxon[target] || [];
  if (sampleIds.length) {
    const sample = QuizState.data.samples[pickOne(sampleIds)];
    const locality = QuizState.data.geochronology.localities[sample.locality];
    if (locality?.age?.period && !QUIZ_PERIOD_BLOCKLIST.has(locality.age.period)) {
      facts.period = { valueKind: "period", value: locality.age.period };
      facts.period_in = { valueKind: "period_in", value: locality.age.period };
    }
    if (locality?.country) {
      facts.country = { valueKind: "country", value: locality.country };
    }
  }
  if (chain[1] && chain[1] !== target) {
    facts.phylum = { valueKind: "taxon", value: chain[1] };
  }
  if (chain[2] && chain[2] !== target) {
    facts.class = { valueKind: "taxon", value: chain[2] };
  }
  if (QuizState.taxaIndex[target]?.rank) {
    facts.rank = { valueKind: "rank", value: QuizState.taxaIndex[target].rank };
  }
  // Extract meaning per language so each rendered riddle uses words in that
  // language (falls back to English when a language's etymology has no usable
  // quoted phrase).
  const enMeaning = extractEtymologyMeaning(target, "en");
  const meaningByLang = {
    el: extractEtymologyMeaning(target, "el") || enMeaning,
    en: enMeaning,
    grc: extractEtymologyMeaning(target, "grc") || enMeaning,
  };
  if (meaningByLang.el || meaningByLang.en || meaningByLang.grc) {
    facts.meaning = { valueKind: "literal_lang", value: meaningByLang };
  }
  if (facts.country) {
    // Pre-localized "in <country>" phrase (handles gender/case per language).
    facts.country_in = { valueKind: "country_in", value: facts.country.value };
  }
  return facts;
}

function buildRiddleQuestion(excludeTaxa) {
  const lang = getLang();
  const pool = Array.from(QuizState.taxaWithAi).filter(k => {
    if (excludeTaxa.has(k)) return false;
    const samples = QuizState.samplesByTaxon[k] || [];
    return samples.length > 0;
  });
  if (pool.length < 4) return null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const target = pickOne(pool);
    const facts = collectFactsFor(target, lang);
    // Find templates whose required facts are all available.
    const usableTemplates = RIDDLE_TEMPLATES.filter(t =>
      t.needs.every(n => facts[n] !== undefined)
    );
    if (!usableTemplates.length) continue;
    const template = pickOne(usableTemplates);
    const templateIdx = RIDDLE_TEMPLATES.indexOf(template);
    const usedFacts = template.needs.map(n => facts[n]);
    // Any taxon names that will literally appear in the rendered riddle text
    // (e.g. the phylum name) — these can't be distractors or we leak the answer.
    const factTaxonValues = new Set(
      usedFacts.filter(f => f.valueKind === "taxon").map(f => f.value)
    );
    // Distractors must fail at least one of the template's facts AND not be
    // name-similar to the target AND not literally appear in the text.
    const distractorPool = pool
      .filter(k => k !== target)
      .filter(k => !namesShareStem(target, k))
      .filter(k => !factTaxonValues.has(k))
      .filter(k => usedFacts.some(f => !factAppliesTo(f, k)));
    if (distractorPool.length < 3) continue;
    const distractors = shuffle(distractorPool).slice(0, 3);
    const choices = shuffle(
      [target, ...distractors].map(k => ({
        key: k,
        isCorrect: k === target,
      }))
    );
    return {
      type: "riddle",
      target,
      promptKey: "quiz-prompt-riddle",
      media: { kind: "riddle-tmpl", templateIdx, facts, needs: template.needs },
      choices,
      hintMax: 0,
      hintsUsed: 0,
      choiceLabeller: (k, lang) => getTaxonDisplayName(k, lang),
    };
  }
  return null;
}

// Words and patterns that mark a sentence as "trivia-worthy" — talking about
// specific morphological/biological traits rather than taxonomic preamble.
const TRIVIA_SPECIFIC_TERMS = {
  en: /\b(eyes?|teeth|tooth|shell|limb|wing|spine|claw|jaw|skull|fin|tail|snout|crest|horn|antenna|valve|lens|hinge|ornament|spike|coil|chamber|whorl|carapace|pygidium|glabella|notable|distinguishing|distinctive|characteristic|unique|remarkable|striking|crystalline|elongate|robust|massive|delicate)\b/i,
  el: /\b(μάτι|μάτια|δόντι|δόντια|όστρακο|φτερό|σπονδυλικ|νύχι|σαγόνι|κρανίο|πτερύγιο|ουρά|ρύγχος|λοφίο|κέρας|κεραίες|βαλβίδα|φακός|φακοί|κόγχ|χαρακτηριστικ|μοναδικ|αξιοσημείωτ|εντυπωσιακ|μεγαλόπρεπ|χονδρ|λεπτ|κρυσταλλικ|γλαβέλλα|πυγίδιο)\b/i,
  grc: /\b(ὀφθαλμ|ὀδούς|ὀδόντες|ὀδόντων|ὄστρακον|πτέρυξ|πτερόν|σπονδύλ|κρανίον|ὀστοῦν|οὐρά|θάλαμος|κέρας|κεραῖαι|βαλβίς|φακός|μοναδικ|χαρακτηριστικ|σπάνιον|μεγαλοπρεπ)\b/i,
};

const TRIVIA_GENERIC_PATTERNS = {
  en: /\bis (an?|the) (extinct |large |small |diverse )?(genus|family|order|class|phylum|kingdom|species|clade|group|tribe) of\b/i,
  el: /(είναι (ένα|ένας|μια|μία|ένα) (εξαφανισμέν|μεγάλ|μικρ|ποικιλόμορφ)?\s*(γένος|οικογένεια|τάξη|κλάση|φύλο|βασίλειο|είδος|κλάδος|ομάδα|φυλή))/i,
  grc: /(εἶναι|ἐστὶ|ἦν) (γένος|οἰκογένεια|τάξις|κλάσις|φῦλον|βασίλειον|εἶδος|κλάδος)/i,
};

function scoreTriviaSentence(s, lang) {
  let score = 0;
  // Penalize generic taxonomic preambles ("X is a genus of …")
  if ((TRIVIA_GENERIC_PATTERNS[lang] || TRIVIA_GENERIC_PATTERNS.en).test(s)) score -= 5;
  // Reward sentences mentioning specific morphological or descriptive terms
  if ((TRIVIA_SPECIFIC_TERMS[lang] || TRIVIA_SPECIFIC_TERMS.en).test(s)) score += 4;
  // Prefer mid-length sentences (more interesting than one-liners or essays)
  if (s.length >= 70 && s.length <= 180) score += 2;
  if (s.length < 50 || s.length > 220) score -= 1;
  return score;
}

// Return scored, sanitized trivia candidates for a taxon in the given
// language. Returns sentences sorted from best to worst. Caller can pick the
// same INDEX across languages to keep trivia roughly parallel.
// Split text into sentences, but DON'T split inside parentheses — descriptions
// often have parentheticals like "(Striatolamia macrota, Agassiz 1843)" with
// internal periods that aren't real sentence boundaries.
function splitSentencesParenAware(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    cur += c;
    if (depth === 0 && /[.!?]/.test(c) && /\s/.test(text[i + 1] || " ")) {
      out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Return {raw, sanitized} trivia candidates in their ORIGINAL description
// order (so the Nth candidate in EN corresponds to the Nth in EL / GRC,
// assuming the descriptions are parallel translations). Filter out generic
// preambles and garbage fragments.
function triviaCandidates(taxonKey, lang) {
  const descArr = QuizState.taxaIndex[taxonKey]?.description?.[lang];
  if (!descArr || !descArr.length) return [];
  const fullText = descArr.join(" ");
  const rawSentences = splitSentencesParenAware(fullText);
  const targetNames = Object.values(QuizState.taxaIndex[taxonKey].name || {}).filter(Boolean);
  return rawSentences
    .map(s => s.trim().replace(/^[\)\],.;:!?\s—\-]+/, "")) // strip leading garbage
    .filter(s => s.length >= 40 && s.length <= 280)
    .filter(s => /^[\p{L}]/u.test(s))  // must start with a letter, not punctuation
    .filter(s => {
      const lower = s.toLowerCase();
      return !targetNames.some(n => {
        const stem = n.toLowerCase().slice(0, Math.min(5, n.length));
        return stem && lower.startsWith(stem);
      });
    })
    .filter(s => scoreTriviaSentence(s, lang) >= 0)
    .map(s => ({ raw: s, sanitized: sanitizeText(s, taxonKey, lang) }))
    .filter(o => o.sanitized && /^[\p{L}]/u.test(o.sanitized));
}

function extractTriviaSentence(taxonKey, lang) {
  const candidates = triviaCandidates(taxonKey, lang);
  if (!candidates.length) return null;
  return pickOne(candidates.slice(0, Math.max(1, Math.ceil(candidates.length / 2)))).sanitized;
}

function buildTriviaQuestion(excludeTaxa) {
  // Require descriptions in all three languages so the question survives a
  // language switch (we pre-cache the picked sentence per language).
  const pool = Array.from(QuizState.taxaWithAi).filter(k => {
    if (excludeTaxa.has(k)) return false;
    const desc = QuizState.taxaIndex[k]?.description || {};
    return desc.el?.length && desc.en?.length && desc.grc?.length;
  });
  if (pool.length < 4) return null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const target = pickOne(pool);
    // Pick the SAME sentence-index across all three languages so what the user
    // reads in en/el/grc stays roughly parallel when they switch languages.
    const cBy = {
      el: triviaCandidates(target, "el"),
      en: triviaCandidates(target, "en"),
      grc: triviaCandidates(target, "grc"),
    };
    if (!cBy.el.length || !cBy.en.length || !cBy.grc.length) continue;
    const maxIdx = Math.min(cBy.el.length, cBy.en.length, cBy.grc.length);
    if (maxIdx === 0) continue;
    const topHalf = Math.max(1, Math.ceil(maxIdx / 2));
    const idx = Math.floor(Math.random() * topHalf);
    const textByLang = {
      el: cBy.el[idx].sanitized,
      en: cBy.en[idx].sanitized,
      grc: cBy.grc[idx].sanitized,
    };
    const rawByLang = {
      el: cBy.el[idx].raw,
      en: cBy.en[idx].raw,
      grc: cBy.grc[idx].raw,
    };
    if ([textByLang.el, textByLang.en, textByLang.grc].some(t => !t || t.length < 30)) continue;
    const distractorPool = pool.filter(k => k !== target && !namesShareStem(target, k));
    if (distractorPool.length < 3) continue;
    const distractors = shuffle(distractorPool).slice(0, 3);
    const choices = shuffle(
      [target, ...distractors].map(k => ({
        key: k,
        isCorrect: k === target,
      }))
    );
    return {
      type: "trivia",
      target,
      promptKey: "quiz-prompt-trivia",
      media: { kind: "trivia", target, textByLang, rawByLang },
      choices,
      hintMax: 0,
      hintsUsed: 0,
      choiceLabeller: (k, lang) => getTaxonDisplayName(k, lang),
    };
  }
  return null;
}

function buildCuriosityQuestion(excludeTaxa) {
  const lang = getLang();
  const pool = CURIOSITIES.filter(c =>
    QuizState.taxaIndex[c.target] &&
    !excludeTaxa.has(c.target) &&
    c.el && c.en && c.grc
  );
  if (!pool.length) return null;
  const item = pickOne(pool);
  const target = item.target;
  const sanitizedByLang = {
    el: sanitizeText(item.el, target, "el"),
    en: sanitizeText(item.en, target, "en"),
    grc: sanitizeText(item.grc, target, "grc"),
  };
  const distractorPool = Object.keys(QuizState.taxaIndex)
    .filter(k => k !== target && !namesShareStem(target, k));
  if (distractorPool.length < 3) return null;
  const distractors = shuffle(distractorPool).slice(0, 3);
  const choices = shuffle(
    [target, ...distractors].map(k => ({ key: k, isCorrect: k === target }))
  );
  return {
    type: "curiosity",
    target,
    promptKey: "quiz-prompt-curiosity",
    media: { kind: "curiosity", target, textByLang: sanitizedByLang },
    choices,
    hintMax: 0,
    hintsUsed: 0,
    choiceLabeller: (k, lang) => getTaxonDisplayName(k, lang),
  };
}

const QUESTION_BUILDERS = {
  silhouette: buildSilhouetteQuestion,
  locality: buildLocalityQuestion,
  period: buildPeriodQuestion,
  impostor: buildImpostorQuestion,
  relative: buildRelativeQuestion,
  riddle: buildRiddleQuestion,
  trivia: buildTriviaQuestion,
  curiosity: buildCuriosityQuestion,
};

function pickQuestion(excludeTaxa, typeHistory) {
  const types = shuffle(QUIZ_GAME_TYPES);
  // No two consecutive questions of the same type.
  const lastType = typeHistory.length ? typeHistory[typeHistory.length - 1] : null;
  const filteredTypes = types.filter(t => t !== lastType);
  const tryOrder = filteredTypes.length ? filteredTypes : types;
  for (const t of tryOrder) {
    const q = QUESTION_BUILDERS[t](excludeTaxa);
    if (q) return q;
  }
  // Fallback: try all types ignoring exclusion.
  for (const t of types) {
    const q = QUESTION_BUILDERS[t](new Set());
    if (q) return q;
  }
  return null;
}

// ---------- Rendering ----------

function renderRiddleFacts(facts, visibleCount, lang) {
  const visible = facts.slice(0, visibleCount);
  return visible.map(f => {
    let value;
    if (f.valueKind === "period") value = getPeriodDisplayName(f.value, lang);
    else if (f.valueKind === "country") value = countryFlagEmoji(f.value) + " " + getCountryDisplayName(f.value, lang);
    else if (f.valueKind === "taxon") value = getTaxonDisplayName(f.value, lang);
    else if (f.valueKind === "rank") value = tr(f.value, lang);
    else if (f.valueKind === "literal") value = f.value;
    else value = f.value;
    return `<li><span class="riddle-label">${tr(f.key, lang)}</span> <strong>${value}</strong></li>`;
  }).join("");
}

function renderMedia(q) {
  const mediaEl = document.getElementById("quiz-media");
  if (!q.media) {
    mediaEl.innerHTML = "";
    if (q.type === "impostor") {
      // Show 4 thumbnails as part of the choice buttons themselves.
    }
    return;
  }
  const lang = getLang();
  if (q.media.kind === "silhouette") {
    const revealed = q.answered ? "revealed" : "";
    const imgUrl = q.answered ? (getAiThumbUrl(q.target) || q.media.url) : q.media.url;
    mediaEl.innerHTML = `<div class="quiz-pokemon-frame ${revealed}">
      <span class="pokemon-q pokemon-q-1">?</span>
      <span class="pokemon-q pokemon-q-2">?</span>
      <span class="pokemon-q pokemon-q-3">?</span>
      <span class="pokemon-q pokemon-q-4">?</span>
      <span class="pokemon-q pokemon-q-5">?!</span>
      <span class="pokemon-q pokemon-q-6">?</span>
      <div class="pokemon-spark pokemon-spark-1"></div>
      <div class="pokemon-spark pokemon-spark-2"></div>
      <div class="pokemon-spark pokemon-spark-3"></div>
      <img class="quiz-silhouette" src="${imgUrl}" alt="">
    </div>`;
  } else if (q.media.kind === "photo") {
    mediaEl.innerHTML = `<img class="quiz-photo" src="${q.media.url}" alt="">`;
  } else if (q.media.kind === "ai") {
    const cap = q.mediaCaption ? `<figcaption class="quiz-media-caption">${q.mediaCaption()}</figcaption>` : "";
    mediaEl.innerHTML = `<figure><img class="quiz-ai" src="${q.media.url}" alt="">${cap}</figure>`;
  } else if (q.media.kind === "riddle-tmpl") {
    const tmpl = RIDDLE_TEMPLATES[q.media.templateIdx];
    let pattern = tmpl[lang] || tmpl.en;
    for (const factKey of q.media.needs) {
      const fact = q.media.facts[factKey];
      let displayValue;
      if (fact.valueKind === "period") displayValue = getPeriodDisplayName(fact.value, lang);
      else if (fact.valueKind === "period_in") displayValue = tr("period-in-" + fact.value, lang);
      else if (fact.valueKind === "country") displayValue = getCountryDisplayName(fact.value, lang);
      else if (fact.valueKind === "country_in") displayValue = tr("country-in-" + fact.value, lang);
      else if (fact.valueKind === "taxon") displayValue = getTaxonDisplayName(fact.value, lang);
      else if (fact.valueKind === "rank") displayValue = tr(fact.value, lang);
      else if (fact.valueKind === "literal_lang") displayValue = fact.value[lang] || fact.value.en || "";
      else displayValue = fact.value;
      pattern = pattern.replace("{" + factKey + "}", displayValue);
    }
    mediaEl.innerHTML = `<blockquote class="quiz-riddle-prose">${pattern}</blockquote>`;
  } else if (q.media.kind === "trivia") {
    const trivia = (q.media.textByLang && q.media.textByLang[lang]) ||
                   extractTriviaSentence(q.media.target, lang) || "";
    mediaEl.innerHTML = `<blockquote class="quiz-trivia-text">${trivia}</blockquote>`;
  } else if (q.media.kind === "curiosity") {
    const txt = (q.media.textByLang && q.media.textByLang[lang]) || "";
    mediaEl.innerHTML = `<blockquote class="quiz-trivia-text">${txt}</blockquote>`;
  }
}

function renderChoices(q) {
  if (q.isSort) {
    renderSortChoices(q);
    return;
  }
  const lang = getLang();
  const choicesEl = document.getElementById("quiz-choices");
  choicesEl.innerHTML = "";
  // Show an AI thumbnail next to every taxon choice for consistency
  // (locality/period choices are countries/periods — no thumbnail).
  const showThumbs = q.choices.every(c => QuizState.taxaIndex[c.key]);
  q.choices.forEach((choice, idx) => {
    const btn = document.createElement("button");
    btn.className = "choice-button";
    btn.dataset.choiceIdx = idx;
    if (showThumbs) {
      btn.classList.add("choice-with-image");
      const url = getAiThumbUrl(choice.key);
      btn.innerHTML = `<img class="choice-thumb" src="${url}" alt=""><span class="choice-label">${q.choiceLabeller(choice.key, lang)}</span>`;
    } else {
      btn.textContent = q.choiceLabeller(choice.key, lang);
    }
    btn.addEventListener("click", () => handleAnswer(idx));
    choicesEl.appendChild(btn);
  });
}

function renderSortChoices(q) {
  const lang = getLang();
  q.userOrder = q.userOrder || [];
  const orderedSet = new Set(q.userOrder);
  const choicesEl = document.getElementById("quiz-choices");
  const item = (idx, orderPos) => {
    const c = q.choices[idx];
    const thumb = `<img class="choice-thumb" src="${getAiThumbUrl(c.key)}" alt="">`;
    const badge = orderPos ? `<span class="sort-badge">${orderPos}</span>` : "";
    const cls = ["choice-button", "choice-with-image", "sort-item"];
    if (q.answered) {
      cls.push("sort-locked");
      const correctPos = q.correctOrder.indexOf(c.key) + 1;
      if (orderPos === correctPos) cls.push("choice-correct");
      else cls.push("choice-wrong");
    }
    return `<button class="${cls.join(" ")}" data-choice-idx="${idx}" ${q.answered ? "disabled" : ""}>${thumb}<span class="choice-label">${q.choiceLabeller(c.key, lang)}</span>${badge}</button>`;
  };
  const available = q.choices.map((_, idx) => orderedSet.has(idx) ? "" : item(idx, null)).join("");
  const ordered = q.userOrder.map((idx, n) => item(idx, n + 1)).join("");
  const allPlaced = q.userOrder.length === q.choices.length;
  const submitDisabled = !allPlaced || q.answered;
  choicesEl.innerHTML = `
    <div class="quiz-sort-available-label">${tr("quiz-sort-available", lang)}</div>
    <div class="quiz-sort-available">${available || `<span class="quiz-sort-empty">${tr("quiz-sort-empty", lang)}</span>`}</div>
    <div class="quiz-sort-ordered-label">${tr("quiz-sort-ordered", lang)}</div>
    <div class="quiz-sort-ordered">${ordered || `<span class="quiz-sort-empty">${tr("quiz-sort-empty", lang)}</span>`}</div>
    <button id="quiz-sort-submit" class="quiz-primary-btn" ${submitDisabled ? "disabled" : ""}>${tr("quiz-sort-submit", lang)}</button>
  `;
  choicesEl.querySelectorAll(".sort-item").forEach(btn => {
    btn.addEventListener("click", () => handleSortClick(Number(btn.dataset.choiceIdx)));
  });
  const submitBtn = document.getElementById("quiz-sort-submit");
  if (submitBtn) submitBtn.addEventListener("click", () => { if (!q.answered) finalizeSortAnswer(); });
}

function renderQuestion(q) {
  const lang = getLang();
  document.getElementById("quiz-prompt").textContent = tr(q.promptKey, lang);
  document.getElementById("quiz-progress-label").textContent =
    `${tr("quiz-question", lang)} ${QuizState.round.index + 1}/${QUIZ_ROUND_SIZE}`;
  document.getElementById("quiz-score-value").textContent = String(QuizState.round.score);
  renderMedia(q);
  renderChoices(q);
  const hintBtn = document.getElementById("quiz-hint");
  if (q.hintMax > q.hintsUsed) {
    hintBtn.style.display = "";
    hintBtn.textContent = `${tr("quiz-hint", lang)} (−1)`;
  } else {
    hintBtn.style.display = "none";
  }
  document.getElementById("quiz-next").style.display = "none";
  document.getElementById("quiz-feedback").textContent = "";
  document.getElementById("quiz-feedback").className = "quiz-feedback";
}

const QUIZ_MAX_POINTS_PER_Q = 3;

function pointsForQuestion(q) {
  // Each question is worth up to 3 points. Each hint used drops by 1.
  return Math.max(1, QUIZ_MAX_POINTS_PER_Q - q.hintsUsed);
}

// `type:target` is stable per question, so GA4 can rank questions by % correct
// and by median answer time.
function quizQuestionId(q) {
  return `${q.type}:${q.target}`;
}

function emitQuizAnswer(q, isCorrect, extra) {
  const params = {
    question_id: quizQuestionId(q),
    game_type: q.type,
    target: q.target,
    correct: isCorrect,
    answer_time_ms: Math.round(performance.now() - q.shownAt),
    hints_used: q.hintsUsed,
    question_index: QuizState.round.index,
    points_earned: q.pointsEarned,
  };
  if (q.sampleId) params.sample_id = q.sampleId;
  trackEvent("quiz_answer", Object.assign(params, extra || {}));
}

function handleAnswer(idx) {
  const q = QuizState.current;
  if (q.answered) return;
  if (q.isSort) {
    handleSortClick(idx);
    return;
  }
  const lang = getLang();
  q.answered = true;
  const chosen = q.choices[idx];
  const isCorrect = chosen.isCorrect;
  const pointsEarned = isCorrect ? pointsForQuestion(q) : 0;
  q.pointsEarned = pointsEarned;
  QuizState.round.score += pointsEarned;
  emitQuizAnswer(q, isCorrect);
  // Visual feedback on choices.
  document.querySelectorAll(".choice-button").forEach((btn, i) => {
    btn.disabled = true;
    if (q.choices[i].isCorrect) btn.classList.add("choice-correct");
    if (i === idx && !isCorrect) btn.classList.add("choice-wrong");
  });
  const fbEl = document.getElementById("quiz-feedback");
  if (isCorrect) {
    fbEl.textContent = `${tr("quiz-correct", lang)} +${pointsEarned}`;
  } else {
    fbEl.textContent = tr("quiz-wrong", lang);
  }
  fbEl.className = "quiz-feedback " + (isCorrect ? "feedback-correct" : "feedback-wrong");
  document.getElementById("quiz-score-value").textContent = String(QuizState.round.score);
  document.getElementById("quiz-hint").style.display = "none";
  document.getElementById("quiz-next").style.display = "";
  document.getElementById("quiz-next").focus();
  // Re-render media so silhouette unmasks to the colour AI illustration.
  if (q.media?.kind === "silhouette") renderMedia(q);
}

function handleSortClick(idx) {
  const q = QuizState.current;
  if (q.answered) return;
  q.userOrder = q.userOrder || [];
  const existing = q.userOrder.indexOf(idx);
  if (existing >= 0) {
    q.userOrder.splice(existing, 1); // deselect
  } else {
    q.userOrder.push(idx); // append to order
  }
  renderSortChoices(q); // full re-render keeps badges and submit state in sync
}

function finalizeSortAnswer() {
  const q = QuizState.current;
  q.answered = true;
  const userOrderedKeys = q.userOrder.map(i => q.choices[i].key);
  let correctPositions = 0;
  for (let i = 0; i < userOrderedKeys.length; i++) {
    if (userOrderedKeys[i] === q.correctOrder[i]) correctPositions++;
  }
  q.pointsEarned = correctPositions;
  QuizState.round.score += correctPositions;
  emitQuizAnswer(q, correctPositions === q.choices.length, { correct_positions: correctPositions });
  const lang = getLang();
  renderSortChoices(q); // re-render in locked state with correctness markers
  // Append correct-position badges as a separate decoration on each card.
  document.querySelectorAll(".sort-item").forEach((btn) => {
    const idx = Number(btn.dataset.choiceIdx);
    const correctPos = q.correctOrder.indexOf(q.choices[idx].key) + 1;
    const badge = document.createElement("span");
    badge.className = "sort-correct-badge";
    badge.textContent = String(correctPos);
    btn.appendChild(badge);
  });
  const fbEl = document.getElementById("quiz-feedback");
  const allCorrect = correctPositions === q.choices.length;
  fbEl.textContent = allCorrect
    ? `${tr("quiz-correct", lang)} +${correctPositions}`
    : `${correctPositions}/${q.choices.length} • +${correctPositions}`;
  fbEl.className = "quiz-feedback " + (allCorrect ? "feedback-correct" : "feedback-wrong");
  document.getElementById("quiz-score-value").textContent = String(QuizState.round.score);
  document.getElementById("quiz-hint").style.display = "none";
  document.getElementById("quiz-next").style.display = "";
  document.getElementById("quiz-next").focus();
}

function handleHint() {
  const q = QuizState.current;
  if (q.hintsUsed < q.hintMax) {
    q.hintsUsed += 1;
    trackEvent("quiz_hint_used", { question_id: quizQuestionId(q), game_type: q.type });
    renderMedia(q);
    if (q.hintsUsed >= q.hintMax) {
      document.getElementById("quiz-hint").style.display = "none";
    }
  }
}

function nextQuestion() {
  if (QuizState.round.index + 1 >= QUIZ_ROUND_SIZE) {
    endRound();
    return;
  }
  QuizState.round.index += 1;
  buildAndShowQuestion();
}

function buildAndShowQuestion() {
  const q = pickQuestion(QuizState.round.usedTaxa, QuizState.round.typeHistory);
  if (!q) {
    endRound();
    return;
  }
  q.answered = false;
  q.shownAt = performance.now();
  QuizState.current = q;
  QuizState.round.typeHistory.push(q.type);
  if (q.target) {
    QuizState.round.usedTaxa.add(q.target);
    QuizState.round.targetsThisRound.push(q.target);
  }
  renderQuestion(q);
}

const QUIZ_RECENT_KEY = "tsiofto-quiz-recent-targets";
const QUIZ_RECENT_MAX = 25;

function loadRecentTargets() {
  try {
    const raw = localStorage.getItem(QUIZ_RECENT_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (_) {
    return new Set();
  }
}

function persistRecentTargets(usedThisRound) {
  try {
    const existing = JSON.parse(localStorage.getItem(QUIZ_RECENT_KEY) || "[]");
    const combined = [...usedThisRound, ...existing];
    const trimmed = Array.from(new Set(combined)).slice(0, QUIZ_RECENT_MAX);
    localStorage.setItem(QUIZ_RECENT_KEY, JSON.stringify(trimmed));
  } catch (_) {
    // localStorage unavailable — silently no-op.
  }
}

function startRound() {
  // Seed the round's "used taxa" with recent ones from previous sessions so we
  // don't see the same Spinosaurus → Aves question every time. Falls back
  // gracefully if the pool gets too small (question builders re-try with an
  // empty set when needed).
  const recentAcrossSessions = loadRecentTargets();
  QuizState.round = {
    index: 0,
    score: 0,
    usedTaxa: recentAcrossSessions,
    typeHistory: [],
    targetsThisRound: [],
    startedAt: performance.now(),
  };
  trackEvent("quiz_started");
  document.getElementById("quiz-intro-screen").style.display = "none";
  document.getElementById("quiz-end-screen").style.display = "none";
  document.getElementById("quiz-game-screen").style.display = "";
  buildAndShowQuestion();
}

function endRound() {
  document.getElementById("quiz-game-screen").style.display = "none";
  document.getElementById("quiz-end-screen").style.display = "";
  const maxScore = QUIZ_ROUND_SIZE * QUIZ_MAX_POINTS_PER_Q;
  document.getElementById("quiz-final-score-value").textContent =
    `${QuizState.round.score}/${maxScore}`;
  trackEvent("quiz_completed", {
    score: QuizState.round.score,
    max_score: maxScore,
    total_time_ms: Math.round(performance.now() - QuizState.round.startedAt),
  });
  persistRecentTargets(QuizState.round.targetsThisRound);
}

function bindControls() {
  document.getElementById("quiz-start").addEventListener("click", startRound);
  document.getElementById("quiz-hint").addEventListener("click", handleHint);
  document.getElementById("quiz-next").addEventListener("click", nextQuestion);
  document.getElementById("quiz-play-again").addEventListener("click", startRound);
}

// Re-render the current question (and screen labels) when the active language changes.
function observeLanguageChange() {
  const obs = new MutationObserver(() => {
    if (QuizState.current && document.getElementById("quiz-game-screen").style.display !== "none") {
      // Preserve question state, just re-render labels.
      const q = QuizState.current;
      const lang = getLang();
      document.getElementById("quiz-prompt").textContent = tr(q.promptKey, lang);
      document.getElementById("quiz-progress-label").textContent =
        `${tr("quiz-question", lang)} ${QuizState.round.index + 1}/${QUIZ_ROUND_SIZE}`;
      renderMedia(q);
      renderChoices(q);
      if (q.answered) {
        document.querySelectorAll(".choice-button").forEach((btn, i) => {
          btn.disabled = true;
          if (q.choices[i].isCorrect) btn.classList.add("choice-correct");
        });
        const fbEl = document.getElementById("quiz-feedback");
        const text = fbEl.textContent;
        if (text) {
          const wasCorrect = fbEl.classList.contains("feedback-correct");
          fbEl.textContent = wasCorrect ? tr("quiz-correct", lang) : tr("quiz-wrong", lang);
        }
        document.getElementById("quiz-hint").style.display = "none";
        document.getElementById("quiz-next").style.display = "";
            }
    }
  });
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
}

function initQuiz() {
  bindControls();
  observeLanguageChange();
  quizLoadData().catch(err => {
    console.error("Quiz failed to load data:", err);
  });
}

window.addEventListener("DOMContentLoaded", initQuiz);
