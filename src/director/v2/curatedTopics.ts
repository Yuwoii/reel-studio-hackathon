// W7 curated "HOW IT WORKS" topics — seeded from research/topics/W7-topics.json (W7-B topic scout: 18 fundamental
// "how everyday tech actually works" topics scored against primary sources). GENERATED once from that file and then
// kept here as data, so the bot image needs nothing from research/. Each entry: the one question / one answer pair,
// the two primary sources the scout read (the director still researches and fetches them itself — these are LEADS,
// never pre-verified facts), and the scout's beat outline. A "[needs source]" beat must be sourced or cut (L16).
//
// topics.ts picks from this list when !reel has no topic or a vague one.

export interface CuratedTopic {
  slug: string;
  title: string;
  question: string;
  answer: string;
  /** ≤ 2 primary sources (leads; the director must web_fetch them before citing). */
  sources: readonly string[];
  /** The scout's beat outline (leads, not a script). */
  outline: readonly string[];
  /** wow + drawability + source scores (3–15). */
  score: number;
  /** One of the scout's three pilot picks. */
  pilot: boolean;
  note?: string;
}

export const CURATED_TOPICS: readonly CuratedTopic[] = Object.freeze([
  {
    "slug": "touchscreen",
    "title": "How a touchscreen knows where your finger is",
    "question": "Glass can't feel you, so how does your screen know exactly where your finger is?",
    "answer": "Under the glass is a grid of invisible wires that keep measuring the electric field between them, and your finger steals a tiny bit of that field at the spot you touch.",
    "sources": [
      "https://www.ti.com/lit/wp/slay048a/slay048a.pdf",
      "https://ww1.microchip.com/downloads/en/DeviceDoc/93064A.pdf"
    ],
    "outline": [
      "HOOK: 'Your screen can't feel pressure. So how does glass know exactly where your finger is?' (finger silhouette above a phone cross-sectio…",
      "STAKES: the signal it looks for is a change of less than 1 picofarad, a trillionth of a farad (HeroStat '<1 pF') [TI SLAY048]",
      "REVEAL: 'It isn't feeling your finger. It's feeling what your finger steals.'",
      "INTUITION: cross-section drawOn: cover glass / transparent sensor layers / display",
      "MECHANISM 1: two layers of transparent electrodes, rows = transmit (TX), columns = receive (RX) [Microchip TB3064]",
      "MECHANISM 1b: every crossing is a node, a tiny capacitor; zoom from full grid to one node",
      "SECOND QUESTION: 'But there are hundreds of crossings. How does it find the one you're on?'",
      "MECHANISM 2: controller pulses ONE row at a time (row lights lime, sweep)",
      "MECHANISM 2b: the pulse couples charge across into every column; field lines arc TX->RX at the node",
      "MECHANISM 3: a finger is a conductor tied to ground; it pulls part of the field away (field lines bend into the fingertip) [TI, Microchip A…",
      "MECHANISM 3b: so the charge received on that column DROPS at that one crossing [Infineon AN64846]",
      "MECHANISM 4: sweep all rows -> a heat grid of 'how much charge went missing' per node",
      "MECHANISM 4b: the dip spreads over a few crossings; its centre gives the exact spot (the row tells how high, the column how far across)",
      "SURPRISE: your body's own capacitance to ground is 100-200 pF, the touch signal is under 1 pF, hundreds of times smaller [Microchip AN2934…",
      "SURPRISE 2: because every node is measured separately, two fingers = two separate hot spots: multi-touch for free [Microchip TB3064]",
      "LIMIT 1: a thick glove holds the finger too far from the glass, so it steals too little field to pass the threshold (thin gloves / glove modes still work) [TI: body as conductor]",
      "LIMIT 2: water is conductive too; mutual-capacitance sensing tolerates it far better than older self-capacitance buttons [NXP AN12082]",
      "LIMIT 3: why a capacitive stylus has a conductive tip (it has to steal the field like a finger)",
      "CLIMAX (KineticWord): 'It feels what you steal.'",
      "CLOSURE: every tap dims the field at a few crossings, measured hundreds of times a second (rate: [needs source])",
      "CTA: 'Follow for how everyday tech actually works.'"
    ],
    "score": 15,
    "pilot": true
  },
  {
    "slug": "heartbeat-ppg",
    "title": "How your watch sees your heartbeat with green light",
    "question": "Your watch has no needle and no strap round your chest, so how does it count your heartbeats?",
    "answer": "It flashes green light into your wrist hundreds of times a second, and every heartbeat pushes more blood under the sensor, which swallows a little more green light.",
    "sources": [
      "https://support.apple.com/en-us/120277",
      "https://www.analog.com/en/resources/design-notes/using-reflectometry-for-a-ppg-waveform.html"
    ],
    "outline": [
      "HOOK: 'Flip your watch over. Those green lights are counting your heartbeat. Here's how.'",
      "STAKES: it flashes its LEDs hundreds of times per second and supports 30-210 bpm [Apple 120277]",
      "REVEAL: 'It doesn't hear your heart. It watches your blood swallow light.'",
      "INTUITION: blood is red because it reflects red and absorbs green [Apple]",
      "MECHANISM 1: cross-section: watch back, LEDs, photodiode, skin layers, capillaries",
      "MECHANISM 1b: green light enters, scatters, some bounces back to the photodiode (reflective PPG) [ADI reflectometry]",
      "SECOND QUESTION: 'But your blood is always there. How does a beat show up?'",
      "MECHANISM 2: each heartbeat swells the vessels with more blood -> more green absorbed -> less light returns [Apple]",
      "MECHANISM 2b: between beats, less blood -> more light returns; draw the waveform building live (pulsatile 'AC' on a big steady 'DC') [ADI]",
      "MECHANISM 3: count peaks per minute -> heart rate (HeroStat counting up)",
      "MECHANISM 4: why green: hemoglobin absorbs strongly near 540/570 nm; LEDs at ~530 nm are bright and efficient [ADI guidelines]",
      "MECHANISM 4b: green is absorbed near the surface, ideal for capillaries just under wrist skin, and stray room light bothers it less [ADI]",
      "SURPRISE: the same sensor can switch to infrared, e.g. during your sleep schedule [Apple]",
      "SURPRISE 2: for a sharper reading, a finger on the crown closes an electrical circuit across your heart: ECG, a different sensor entirely […",
      "LIMIT 1: motion: a swinging arm changes contact and floods the waveform with noise (motion artifacts) [ADI]",
      "LIMIT 2: loose fit or light leaking in; room lights flicker at 100/120 Hz (twice the mains frequency) [ADI]",
      "LIMIT 3: skin pigment and tattoos absorb light before it reaches blood; sensor compensates by raising LED brightness and sampling rate [ADI…",
      "CLIMAX (KineticWord): 'Your blood dims the light.'",
      "CLOSURE: every beat is a tiny shadow your watch catches in the green.",
      "CTA: 'Follow for how everyday tech actually works.'"
    ],
    "score": 15,
    "pilot": false,
    "note": "The owner's reference folder already holds a reel on exactly this topic: make it look and read clearly different."
  },
  {
    "slug": "gps-relativity",
    "title": "Why every GPS satellite clock is set to tick slow",
    "question": "How does a phone with no idea where it is find itself to within a few metres, from satellites 20,000 km away?",
    "answer": "Each satellite shouts the exact time, your phone measures how late each shout arrives, and the delays tell it how far away each satellite is; but the satellite clocks tick fast because of relativity and must be corrected.",
    "sources": [
      "https://www.nist.gov/atomic-clocks/a-powerful-tool-for-science/putting-einstein-test",
      "https://www.nist.gov/how-do-you-measure-it/how-do-you-measure-your-location-using-gps"
    ],
    "outline": [
      "HOOK: 'Your blue dot depends on Einstein: every GPS satellite clock is tuned for relativity.'",
      "STAKES: satellites ~20,200 km up; at least 4 visible from nearly anywhere [NIST]",
      "REVEAL: 'GPS doesn't measure distance. It measures time.'",
      "MECHANISM 1: each satellite broadcasts its time and position, signals travel at light speed [NIST, FAA]",
      "MECHANISM 1b: arrival delay x speed of light = distance -> a sphere around one satellite [NOAA]",
      "MECHANISM 2: second satellite -> spheres intersect in a circle; third -> two points [NOAA]",
      "SECOND QUESTION: 'So why does your phone need a FOURTH satellite?'",
      "MECHANISM 3: your phone's clock is cheap; the 4th satellite solves for clock error, so no atomic clock needed in your pocket [FAA]",
      "MECHANISM 3b: why precision matters: light travels ~300 m in one microsecond (derived: c x 1 µs) -> nanoseconds count",
      "SURPRISE SETUP: each satellite carries atomic clocks [NIST]",
      "SURPRISE 1: fast orbit -> special relativity slows the clocks by 7 µs/day [NIST]",
      "SURPRISE 2: weaker gravity up there -> general relativity speeds them by 45 µs/day [NIST]",
      "SURPRISE 3: net +38 µs/day; gravity effect is ~6x the speed effect [NIST; Mungan]",
      "STAKES TRANSLATED: 38 µs is about 11 km of light travel (derived; label as calculation) — far too much to leave uncorrected; NEVER '11 km of position error per day' (the receiver solves a shared clock offset)",
      "FIX: clocks get a fixed frequency offset of -4.4645e-10 before launch so they tick at ground rate [Ashby & Weiss NIST TN1385]",
      "LIMIT 1: indoors / urban canyons: signals blocked or reflected [needs source]",
      "LIMIT 2: ionosphere and troposphere slow the signal, receiver must correct [FAA]",
      "CONTEXT: GPS is the longest-running test of Einstein's theories [NIST]",
      "CLIMAX (KineticWord): 'Your location is a clock.'",
      "CLOSURE: every blue dot is four timestamps and a relativity patch.",
      "CTA: 'Follow for how everyday tech actually works.'"
    ],
    "score": 14,
    "pilot": true
  },
  {
    "slug": "noise-cancelling",
    "title": "How noise-cancelling headphones quiet sound with sound",
    "question": "How can headphones make a plane engine quieter by playing MORE sound?",
    "answer": "A microphone hears the noise, a chip makes a near mirror-image wave, and where a hill of air pressure meets a matching valley they cancel, so most of the low rumble is gone.",
    "sources": [
      "https://www.infineon.com/assets/row/public/documents/30/42/infineon-an120538-xensiv-mems-microphones-in-noise-cancelling-headsets-applicationnotes-en.pdf",
      "https://d3uzseaevmutz1.cloudfront.net/pubs/whitePaper/WP_Ambient_noise_cancellation_for_headphones_and_handsets.pdf"
    ],
    "outline": [
      "HOOK: 'Your headphones fight noise by adding more noise. Here's the trick.'",
      "INTUITION: sound is waves of air pressure: hills and valleys (draw a waveform)",
      "REVEAL: 'Flip a wave upside down and add it to the original: they cancel.' (two waveforms sum to a nearly flat line)",
      "MECHANISM 1: anti-noise: identify ambient noise and generate an anti-noise signal in real time [Infineon AN120538]",
      "MECHANISM 2 (feed-forward): outside mic hears noise BEFORE it reaches your ear; inverted and added to the speaker drive [Cirrus WP]",
      "MECHANISM 3 (feedback): inside mic hears what actually reaches your ear and keeps pushing toward a null [Cirrus WP]",
      "MECHANISM 3b: hybrid uses both [Infineon]",
      "SECOND QUESTION: 'So why can you still hear people talking?'",
      "MECHANISM 4: timing: the flipped wave must arrive exactly on time (valley on hill); for short waves a tiny delay flips cancel into add (show two waves slipping out of…",
      "MECHANISM 4b: so ANC works best below ~1 kHz: engines, rumble, hum [Infineon; Cirrus]",
      "MECHANISM 5: above that, the ear seal and padding block noise passively [Cirrus]",
      "SURPRISE: some headphones also retune themselves as the fit and seal on your head shift [Infineon]",
      "SURPRISE 2: your music must not be cancelled too, so the system has to subtract it from what the inner mic hears [Cirrus]",
      "LIMIT 1: wind: outside mic picks up wind noise [Infineon]",
      "LIMIT 2: sudden sounds (a clap, a voice) are harder to cancel than steady drones [needs source]",
      "LIMIT 3: the 'pressure' feeling / your own voice sounding loud with a tight seal [Cirrus 'self noises']",
      "CLIMAX (KineticWord): 'Quiet is two waves.'",
      "CLOSURE: the quiet you hear on a plane is a speaker working hard.",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) STAKES with number if sourced: dB of attenuation for a commercial headset [needs source]"
    ],
    "score": 13,
    "pilot": true
  },
  {
    "slug": "wireless-charging",
    "title": "How a phone charges with no wire",
    "question": "How does power jump through solid glass into your phone with no metal touching?",
    "answer": "A coil in the pad makes a magnetic field that flips direction over a hundred thousand times a second, and that changing field pushes current around a second coil in your phone.",
    "sources": [
      "https://www.wirelesspowerconsortium.com/knowledge-base/magnetic-induction/how-qi-works/",
      "https://www.wirelesspowerconsortium.com/media/cd4ljryt/qi-v13-introduction.pdf"
    ],
    "outline": [
      "HOOK: 'Nothing touches, yet power flows through glass into your phone.'",
      "REVEAL: 'Two coils and a magnetic field that never stops changing.' [WPC]",
      "MECHANISM 1: AC current in the transmitter coil -> magnetic field [WPC]",
      "MECHANISM 2: changing field through receiver coil induces voltage (Faraday) [WPC Qi intro]",
      "MECHANISM 2b: phone rectifies it back to DC to charge the battery [WPC]",
      "STAKES: operating frequency ~87-205 kHz: the field flips direction ~100,000+ times a second [WPC Qi intro]",
      "SECOND QUESTION: 'So why does it stop working if you move the phone 2 cm?'",
      "MECHANISM 3: coupling: a transformer couples ~1.0; Qi coils couple 0.5 or less [WPC]",
      "MECHANISM 3b: practical gap under 5 mm; alignment matters [Electronic Design]",
      "MECHANISM 4: the phone TALKS back to the charger: requests power, tells it to stop when full [WPC]",
      "MECHANISM 4b: power is tuned by shifting frequency along a resonance curve: lower frequency = more power [WPC; ED]",
      "SURPRISE: the field passes through plastic, glass, water, wood and air, but metal heats up -> foreign object detection [WPC]",
      "LIMIT 1: thick cases / misalignment -> slow or no charge",
      "LIMIT 2: power levels: baseline ≤5 W, extended up to 15 W, architecture to ~30 W [WPC Qi intro]",
      "LIMIT 3: wasted energy becomes heat (efficiency figure [needs source])",
      "CLIMAX (KineticWord): 'The field carries the power.'",
      "CLOSURE: your charger is half a transformer; your phone is the other half.",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) Magnets in MagSafe/Qi2 fix alignment [needs source]",
      "(spare) Contrast: same induction as an electric toothbrush [needs source]"
    ],
    "score": 12,
    "pilot": false
  },
  {
    "slug": "face-id",
    "title": "How Face ID sees your face in 3D",
    "question": "How does your phone tell your real face from a photo of you, even in the dark?",
    "answer": "It sprays more than 30,000 invisible infrared dots on your face, and because dots on closer parts land in slightly different places, the camera can work out the shape of your face in 3D.",
    "sources": [
      "https://www.apple.com/newsroom/2017/09/the-future-is-here-iphone-x/",
      "https://support.apple.com/en-us/102381"
    ],
    "outline": [
      "HOOK: 'Every time you unlock your phone, it fires 30,000 invisible dots at your face.' [Apple newsroom]",
      "REVEAL: 'A photo is flat. Your face isn't. Face ID measures depth.' [Apple 102381]",
      "MECHANISM 1: TrueDepth = dot projector + infrared camera + flood illuminator [Apple newsroom]",
      "MECHANISM 1b: flood illuminator lights your face with IR so it works in total darkness [Apple 102381]",
      "MECHANISM 2: projector casts a fixed known dot pattern [Apple]",
      "SECOND QUESTION: 'But how do dots turn into depth?'",
      "MECHANISM 3: projector and camera sit a fixed distance apart (baseline) [structured light refs]",
      "MECHANISM 3b: a dot hitting your nose lands in a different spot on the camera image than one hitting your cheek: displacement = depth (tria…",
      "MECHANISM 4: thousands of dot shifts -> depth map [Apple 102381]",
      "MECHANISM 5: depth map + IR image -> neural network -> math representation compared with the enrolled one inside the Secure Enclave [Apple…",
      "SURPRISE: a random person unlocking your phone: less than 1 in 1,000,000 [Apple 102381]",
      "SURPRISE 2: it checks attention, eyes must be open [Apple]",
      "LIMIT 1: twins, siblings, children under 13 raise the odds [Apple]",
      "LIMIT 2: only five failed attempts before passcode [Apple]",
      "LIMIT 3: works best 25-50 cm from your face [Apple]",
      "CLIMAX (KineticWord): 'It checks your 3D shape, not just a picture.'",
      "CLOSURE: the photo fails because it has no depth to bend the dots.",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) adapts to beard/makeup changes [Apple]",
      "(spare) 2D photo vs face dot-shift contrast image"
    ],
    "score": 13,
    "pilot": false
  },
  {
    "slug": "ssd-flash",
    "title": "How an SSD remembers with trapped electrons",
    "question": "Your photos stay saved with the phone switched off, so where exactly is a 'bit' kept?",
    "answer": "Each memory cell is a tiny transistor with an insulated trap; pushing electrons into the trap shifts the voltage needed to switch it on, and that shift is the bit.",
    "sources": [
      "https://people.engr.tamu.edu/ajiang/data_representation_for_flash_memories.pdf",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC5455833/"
    ],
    "outline": [
      "HOOK: 'Your photos are stored as electrons locked in a cage.'",
      "REVEAL: 'A bit is a handful of trapped electrons.'",
      "MECHANISM 1: cell = floating-gate (or charge-trap) transistor [TAMU Jiang & Bruck]",
      "MECHANISM 1b: cross-section: control gate / blocking oxide / storage layer / tunnel oxide (~6–8 nm in NAND) / channel; both oxides are insulators [PMC review]",
      "MECHANISM 2: programming: high voltage pulls electrons through the oxide into the trap (Fowler-Nordheim tunnelling) [TAMU]",
      "MECHANISM 2b: insulator all round, so electrons stay with power off",
      "SECOND QUESTION: 'But you can't see electrons, so how do you read it?'",
      "MECHANISM 3: trapped charge shifts the threshold voltage; apply a test voltage: does current flow? [TAMU; PMC]",
      "MECHANISM 4: SLC = 2 levels = 1 bit; more levels = more bits: MLC 4, TLC 8, QLC 16 [TAMU: log2 q bits]",
      "MECHANISM 4b: show the voltage ladder splitting into 16 narrow bands",
      "SURPRISE: in planar NAND, roughly 80 electrons per cell [glennklockwood, secondary, verify]",
      "SURPRISE 2: erasing works in big blocks, not single bits [needs source]",
      "LIMIT 1: every program/erase damages the oxide -> limited endurance [glennklockwood; verify primary]",
      "LIMIT 2: electrons leak out over years -> retention loss [glennklockwood]",
      "LIMIT 3: more levels = narrower margins -> more error correction, slower, less endurance [glennklockwood]",
      "CLIMAX (KineticWord): 'A bit is a voltage.'",
      "CLOSURE: switching off doesn't free them; the oxide holds them in.",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) charge-trap vs floating gate table",
      "(spare) 3D NAND stacks cells vertically [needs source]"
    ],
    "score": 11,
    "pilot": false
  },
  {
    "slug": "fiber-optics",
    "title": "How light stays trapped inside an internet cable",
    "question": "How does a laser pulse travel through a glass hair across an ocean without leaking out?",
    "answer": "The glass core is wrapped in glass that bends light slightly differently, so light hitting the wall at a shallow angle bounces back in every time: total internal reflection.",
    "sources": [
      "https://technav.ieee.org/topic/optical-fiber/",
      "https://www.thefoa.org/tech/ref/basic/fiber.html"
    ],
    "outline": [
      "HOOK: 'Your messages cross oceans as flashes of light inside glass thinner than hair.'",
      "REVEAL: 'Light can't escape because the wall is a perfect mirror at shallow angles.'",
      "MECHANISM 1: core index ~1.46, cladding ~1.45 [IEEE TechNav]",
      "MECHANISM 2: Snell's law: light bends at a boundary; past the critical angle it reflects totally [MIT OCW; FOA]",
      "MECHANISM 2b: ray bouncing down the core",
      "SECOND QUESTION: 'But glass isn't perfectly clear. How far can light go?'",
      "MECHANISM 3: single-mode core 8-10 µm; loss as low as ~0.25 dB/km at 1550 nm [IEEE TechNav]",
      "MECHANISM 3b: translate dB into 'half the light left after X km' (derived, label as calculation)",
      "MECHANISM 4: biggest loss is scattering, which falls with wavelength^4: double wavelength = 16x less scattering [FOA]",
      "MECHANISM 4b: that's why long-haul uses infrared 1310/1550 nm windows [FOA]",
      "SURPRISE: multimode vs single-mode: many paths smear pulses (modal dispersion) [FOA]",
      "LIMIT 1: tight bends break the angle -> light leaks (bend loss) [Optica webinar]",
      "LIMIT 2: push wide multimode light into thin single-mode fibre and up to 99% is lost [FOA: 20 dB]",
      "CLIMAX (KineticWord): 'The wall is a mirror.'",
      "CLOSURE: almost every video you stream rides this trapped light for part of its trip",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) refraction of a stick in a pond as intuition [FOA]",
      "(spare) water peak OH absorption [FOA]",
      "(spare) repeaters/amplifiers every N km [needs source]",
      "(spare) light pulse = bit"
    ],
    "score": 13,
    "pilot": false
  },
  {
    "slug": "qr-error-correction",
    "title": "How a QR code still works when it's torn",
    "question": "How can a QR code with a chunk ripped out still scan perfectly?",
    "answer": "A QR code stores extra 'backup math' alongside your data, so the scanner can rebuild up to about 30% of missing or dirty squares.",
    "sources": [
      "https://www.qrcode.com/en/about/error_correction.html",
      "https://www.qrcode.com/en/about/standards.html"
    ],
    "outline": [
      "HOOK: 'Rip a chunk off a QR code. It often still scans. Here's why.'",
      "REVEAL: 'Part of every QR code is a backup of the rest.'",
      "MECHANISM 1: three big squares = finder patterns: the scanner finds position, size and tilt instantly [DENSO/J-STAGE]",
      "MECHANISM 1b: finder detection made reading ~50x faster than other matrix codes [J-STAGE]",
      "MECHANISM 2: data is stored as 8-bit codewords [qrcode.com]",
      "SECOND QUESTION: 'So how do you fix squares you can't even see?'",
      "MECHANISM 3: Reed-Solomon code adds extra codewords [qrcode.com]",
      "MECHANISM 3b: RS needs 2 extra codewords per codeword to correct: 100 data + 100 RS -> 50 fixable = 25% (level Q) [qrcode.com]",
      "MECHANISM 4: four levels: L 7%, M 15%, Q 25%, H 30% [qrcode.com]",
      "MECHANISM 4b: higher level = bigger code for the same data [qrcode.com]",
      "SURPRISE: the same math protects music CDs and data from deep-space probes [qrcode.com]",
      "SURPRISE 2: masking: the code XORs a pattern over the data so black/white is balanced and easy to read [J-STAGE]",
      "LIMIT 1: badly damage a corner finder square and most scanners cannot lock on (finder squares are not error-corrected) [needs source]",
      "LIMIT 2: logo-in-the-middle codes spend error-correction budget",
      "LIMIT 3: size range 21x21 to 177x177 modules [qrcode.com]",
      "CLIMAX (KineticWord): 'Damage is already paid for.'",
      "CLOSURE: the torn data patch was covered by spare codewords from the start (the three corner finder squares are NOT protected).",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) invented by DENSO WAVE for factories [J-STAGE]",
      "(spare) mis-read rate kept to 1e-9 or less [J-STAGE]"
    ],
    "score": 14,
    "pilot": false
  },
  {
    "slug": "shazam-fingerprint",
    "title": "How Shazam names a song in a noisy bar",
    "question": "How does an app recognise a song from 5 seconds of a noisy bar recording?",
    "answer": "It turns the sound into a star map of its loudest frequency peaks, pairs nearby stars into tiny fingerprints, and looks for the song whose fingerprints line up at the same time offset.",
    "sources": [
      "https://www.ee.columbia.edu/~dpwe/papers/Wang03-shazam.pdf",
      "https://ismir2003.ircam.fr/presentations/Wang.PDF"
    ],
    "outline": [
      "HOOK: 'A few seconds, a loud bar, and your phone names the song. It's not listening to the melody.'",
      "REVEAL: 'Shazam turns music into a star map.' [Wang 2003 'constellation maps']",
      "MECHANISM 1: spectrogram: time x frequency x loudness (draw it)",
      "MECHANISM 2: keep only local peaks; amplitude thrown away -> sparse dots [Wang]",
      "MECHANISM 2b: loud peaks mostly survive noise and EQ, so enough of the pattern remains [Wang]",
      "SECOND QUESTION: 'But millions of songs have dots. How does it search fast?'",
      "MECHANISM 3: anchor point + target zone: pair each dot with nearby dots [Wang]",
      "MECHANISM 3b: hash = freq1, freq2, time gap -> packed in a 32-bit number [Wang]",
      "MECHANISM 4: look up hashes in a sorted index of every song [Wang]",
      "MECHANISM 5: the right song shows a spike: many matches at the SAME time offset (histogram) [Wang]",
      "SURPRISE: pairing dots gives ~a million times more specific hashes than single dots; ~10,000x speedup overall [Wang]",
      "SURPRISE 2: works even if many real peaks are lost and noise peaks added [Wang]",
      "LIMIT 1: live versions / covers have different peaks -> no match [needs source]",
      "LIMIT 2: humming fails: no matching constellation",
      "CLIMAX (KineticWord): 'Songs are star maps.'",
      "CLOSURE: your 5 seconds lined up with one song's sky.",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) 'astronavigation' analogy [Wang]",
      "(spare) radio monitoring search times of milliseconds [Wang abstract]",
      "(spare) transparency-over-strip-chart analogy [Wang]"
    ],
    "score": 14,
    "pilot": false
  },
  {
    "slug": "bayer-filter",
    "title": "Why your camera only sees one colour per pixel",
    "question": "Your camera has 12 million pixels, so why does each one only see a single colour?",
    "answer": "Each light sensor is colour-blind, so a mosaic of tiny red, green and blue filters lets each one see only one colour, and software guesses the other two from its neighbours.",
    "sources": [
      "https://www.ece.lsu.edu/ipl/papers/IEEE_SPM2005.pdf",
      "https://www.imaging.org/common/uploaded%20files/pdfs/Papers/2001/PICS-0-251/4631.pdf"
    ],
    "outline": [
      "HOOK: 'Two thirds of the colour in your photos is guessed.'",
      "REVEAL: 'Each pixel sees one colour; the rest is filled in.' [Gunturk IEEE SPM]",
      "MECHANISM 1: a photodiode only measures brightness, not colour [Canon USA DPAF article: photodiode as light meter]",
      "MECHANISM 2: colour filter array on top: Bayer pattern [Palum IS&T]",
      "MECHANISM 2b: 2x2 tile: 2 green, 1 red, 1 blue: 50/25/25 [patent US20170039682 background]",
      "SECOND QUESTION: 'Why twice as much green?'",
      "MECHANISM 3: human eye's sharpness comes mostly from luminance, which green dominates [Palum; Gunturk]",
      "MECHANISM 4: demosaicing: interpolate missing two colours from neighbours [Gunturk]",
      "MECHANISM 4b: animate one pixel 'borrowing' red from 2 neighbours and blue from 2 others",
      "SURPRISE: invented by Bryce Bayer at Kodak, US patent 3,971,065 (1976) [Palum]",
      "SURPRISE 2: Bayer also proposed cyan-magenta-yellow but dyes didn't exist [Wikipedia, secondary]",
      "LIMIT 1: fine stripes/fabric -> false colour, moire [US20170039682: 'color artifacts']",
      "LIMIT 2: alternative is 3 sensors with a beam splitter: expensive [Gunturk]",
      "CLIMAX (KineticWord): 'Colour is a good guess.'",
      "CLOSURE: your photo is a mosaic, rebuilt in milliseconds.",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) Raw files keep the mosaic",
      "(spare) quincunx green grid vs rectangular R/B [Gunturk]",
      "(spare) microlenses [US7755682B2]",
      "(spare) light -> electrons -> number"
    ],
    "score": 12,
    "pilot": false
  },
  {
    "slug": "phase-detect-autofocus",
    "title": "How your camera knows which way to focus",
    "question": "How does a camera snap into focus instantly instead of hunting back and forth?",
    "answer": "Focus pixels are split in two halves that look through opposite sides of the lens; when the two half-images don't line up, the size and direction of the gap tell the lens roughly how far to move, in one go.",
    "sources": [
      "https://www.usa.canon.com/learning/training-articles/training-articles-list/canon-autofocus-series-dual-pixel-cmos-af-explained",
      "https://global.canon/en/news/2013/jul02e.html"
    ],
    "outline": [
      "HOOK: 'Some cameras find focus by trial and error. Yours measures it.'",
      "REVEAL: 'In many cameras, a pixel is two pixels.' (Canon Dual Pixel; others use scattered focus pixels) [Canon USA]",
      "MECHANISM 1: contrast detection: move lens, check sharpness, repeat (hunting) [Canon 2013 contrast AF reference]",
      "MECHANISM 2: phase detection: split the light into two images, measure their offset [Canon global]",
      "MECHANISM 3: dual pixel: each photodiode split into A and B halves, each seeing one side of the lens [Canon USA]",
      "SECOND QUESTION: 'How does a gap between two images tell direction?'",
      "MECHANISM 4: in focus: A and B overlap; front-focused: shifted one way; back-focused: the other way [Canon USA: 'which direction... and by…",
      "MECHANISM 4b: correlation finds the shift [Canon white paper]",
      "MECHANISM 5: microcomputer converts shift -> one big lens move, then a re-measure and fine-tune [Canon white paper]",
      "SURPRISE: the halves are recombined into one pixel for the photo; no resolution lost [Canon USA: 24.2 MP]",
      "LIMIT 1: low light / low contrast subjects make the comparison noisy [needs source]",
      "LIMIT 2: repeating patterns can fool correlation [needs source]",
      "CLIMAX (KineticWord): 'Two halves, one answer.'",
      "CLOSURE: focus is a measurement, not a guess.",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) DSLRs had a separate AF sensor [Canon global]",
      "(spare) Canon introduced in 2013 [Canon global]",
      "(spare) every pixel used for both imaging and AF [Canon global]",
      "(spare) phone sensors use similar split pixels [needs source]",
      "(spare) visual: lens ray diagram"
    ],
    "score": 11,
    "pilot": false
  },
  {
    "slug": "e-ink",
    "title": "How an e-reader keeps a page with zero power",
    "question": "Why can a Kindle show a page for weeks with the battery barely moving?",
    "answer": "Each dot is a tiny capsule of black and white charged particles; a voltage pulls one colour to the top, and once there they stay put without any power.",
    "sources": [
      "https://www.eink.com/tech/detail/How_it_works",
      "https://www.imaging.org/common/uploaded%20files/pdfs/Papers/2006/ICIS-0-736/33769.pdf"
    ],
    "outline": [
      "HOOK: 'Your e-reader uses zero power to show this page. Only to change it.'",
      "REVEAL: 'The ink physically moves, then stays.' [Amundson, E Ink]",
      "MECHANISM 1: millions of microcapsules, each about the width of a human hair [eink.com]",
      "MECHANISM 2: inside: negatively charged white + positively charged black particles in clear fluid [eink.com]",
      "MECHANISM 3: voltage on the pixel electrode -> one set rises to the surface [eink.com]",
      "SECOND QUESTION: 'So why does the screen flash black when you turn the page?'",
      "MECHANISM 4: grey tones = partial moves; errors accumulate [Amundson]",
      "MECHANISM 4b: precise updates drive pixels to black and white extremes first, causing the flash [Amundson]",
      "SURPRISE: image persists unpowered, even grey tones [Amundson]",
      "SURPRISE 2: reflective like paper, readable in sunlight; no backlight [Amundson: near-lambertian]",
      "LIMIT 1: slow refresh, not for video [Philips IS&T context]",
      "LIMIT 2: ghosting from partial updates [Amundson errors]",
      "CLIMAX (KineticWord): 'Moving ink, then rest.'",
      "CLOSURE: the battery pays for turning the page, not reading it.",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) capsules stop pigment drifting sideways [Amundson]",
      "(spare) LCD/OLED contrast: always powered",
      "(spare) colour e-ink [needs source]",
      "(spare) electrophoresis definition [Philips]",
      "(spare) differential drive scheme [Amundson]"
    ],
    "score": 12,
    "pilot": false
  },
  {
    "slug": "microwave-oven",
    "title": "How a microwave actually heats food",
    "question": "How does an invisible wave heat your soup but leave the plate cold?",
    "answer": "The microwave's electric field flips billions of times a second and water molecules keep trying to twist to follow it; that jostling is heat, and glass and most plastics barely absorb it at all.",
    "sources": [
      "https://www.bag.admin.ch/dam/en/sd-web/JbnegZr3mAZv/Fact%20sheet%20microwave%20oven.pdf",
      "https://em.eecs.umich.edu/emag7e/pdf/tb3.pdf"
    ],
    "outline": [
      "HOOK: 'Your microwave doesn't heat food. It makes water molecules dance.'",
      "STAKES: 2.45 GHz: the field changes direction about five billion times per second [BAG]",
      "REVEAL: 'Heat is water molecules twisting to keep up.' [BAG; UMich]",
      "MECHANISM 1: water is a dipole: + end and - end [BAG]",
      "MECHANISM 2: the field flips, dipoles rotate to align, collide with neighbours -> heat (dielectric heating) [IEEE TechNav]",
      "MECHANISM 3: magnetron: electrons spiral in a magnetic field; ~4,000 V; 50-65% efficient [UMich; IEEE]",
      "MECHANISM 3b: waveguide into a metal box; metal reflects so waves bounce [UMich]",
      "SECOND QUESTION: 'So why is your food scalding in spots and icy in others?'",
      "MECHANISM 4: standing waves: wavelength ~12 cm -> fixed hot and cold spots [UMich]",
      "MECHANISM 4b: the turntable/stirrer moves food through them [UMich; IEEE]",
      "SURPRISE: myth 'inside-out': ~95% of energy absorbed in 3 penetration depths; depth ~2 cm in water [UMich]",
      "SURPRISE 2: the door mesh holes are much smaller than 12 cm, so waves can't pass [UMich]",
      "LIMIT 1: ice heats slowly because frozen water can't rotate freely -> defrost mode [IEEE]",
      "LIMIT 2: most plates, glass and plastics are nearly transparent to microwaves (some glazes do heat) [UMich]",
      "CLIMAX (KineticWord): 'Heat is twisting water.'",
      "CLOSURE: a microwave-safe plate warms mostly from the hot food, not the waves.",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) discovered via a melted chocolate bar, Percy Spencer 1940s [UMich]",
      "(spare) 500-2000 W domestic [BAG]",
      "(spare) metal sparks [needs source]"
    ],
    "score": 12,
    "pilot": false
  },
  {
    "slug": "contactless-card",
    "title": "How a contactless card works with no battery",
    "question": "Your bank card has no battery, so where does it get power to talk to the terminal?",
    "answer": "The terminal makes a magnetic field; a coil hidden in the card harvests just enough energy from it to wake the chip, and the card replies by flickering how much of that field it absorbs.",
    "sources": [
      "https://www.analog.com/en/resources/app-notes/2022/07/16/12/55/secure-microcontrollers-nfc-overview.html",
      "https://nfc-forum.org/learn/NFC-technology/"
    ],
    "outline": [
      "HOOK: 'Your card has no battery. The terminal powers it from a few centimetres away.'",
      "REVEAL: 'The reader is the card's power supply.' [SecureIDNews quoting NXP]",
      "MECHANISM 1: antenna coil around the card's edge, connected to the chip [SecureIDNews]",
      "MECHANISM 2: reader field at 13.56 MHz [NFC Forum]",
      "MECHANISM 2b: field induces current in the card coil -> chip wakes [ADI NFC overview]",
      "SECOND QUESTION: 'But how does a card with no transmitter talk back?'",
      "MECHANISM 3: reader -> card: amplitude shift keying (field dips) [ADI]",
      "MECHANISM 4: card -> reader: load modulation, the card changes how much it loads the field; the reader sees the tiny change [ADI]",
      "MECHANISM 4b: draw reader waveform with tiny ripples from the card",
      "SURPRISE: near field: typical range 4 cm or less for ISO 14443; a few centimetres of range makes accidental reads rare; one-time codes protect the payment [ADI]",
      "SURPRISE 2: phones and cards are tested to work within a few centimetres [NFC Forum]",
      "LIMIT 1: two cards in the field at once -> collision [needs source]",
      "LIMIT 2: metal behind the card detunes the coil [NXP antenna design note, partial]",
      "CLIMAX (KineticWord): 'The reader powers the reply.'",
      "CLOSURE: tap = a power plant and a radio for a split second.",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) data rate 106 kbit/s ... [NFC Forum: 46 kbit/s to 1.7 Mbit/s]",
      "(spare) phones emulate a card with NFC",
      "(spare) same induction family as wireless charging (series link)",
      "(spare) Type A vs Type B modulation [ADI]"
    ],
    "score": 12,
    "pilot": false
  },
  {
    "slug": "accelerometer",
    "title": "How your phone knows which way is down",
    "question": "How does your phone know you rotated it, without any moving parts you can see?",
    "answer": "Inside is a microscopic silicon weight on springs with comb-like fingers; when the phone tilts or moves, the weight shifts a tiny bit and the gaps between fingers change, which the chip measures as capacitance.",
    "sources": [
      "https://www.analog.com/en/resources/analog-dialogue/articles/dual-axis-low-g-fully-integrated-accelerometers.html",
      "https://www.analog.com/en/resources/technical-articles/accelerometer-and-gyroscopes-sensors-operation-sensing-and-applications.html"
    ],
    "outline": [
      "HOOK: 'There's a tiny weight on springs inside your phone, and it's moving right now.'",
      "REVEAL: 'Your phone measures how far a microscopic mass sags.'",
      "MECHANISM 1: proof mass on polysilicon springs (F = ma, F = kx -> x = (m/k)a) [ADI Analog Dialogue]",
      "MECHANISM 2: interdigitated comb fingers: moving fingers between fixed plates [ADI]",
      "MECHANISM 3: capacitance C = eA/d: gap shrinks on one side, grows on the other (differential) [ADI tech article]",
      "SECOND QUESTION: 'But the fingers barely move. How is that even measurable?'",
      "MECHANISM 4: hundreds of comb fingers, thinner than a hair, add up their tiny signals (keep historic ADXL dimensions out: phone parts differ) [ADI ADXL202 article]",
      "MECHANISM 4b: fixed plates driven with square waves 180° out of phase; centred = zero, offset = signal proportional to displacement [ADI]",
      "MECHANISM 5: gravity pulls the mass too -> the phone knows which way is down",
      "SURPRISE: air trapped inside acts like a shock absorber, so the tiny mass does not ring [ADI tech article]",
      "SURPRISE 2: sensor can self-test by electrostatically pulling the beam with force fingers [ADI ADXL150]",
      "LIMIT 1: spring stiffness trade-off: softer = more sensitive but less shock-proof [ADI]",
      "LIMIT 2: can't tell steady motion; only acceleration (constant speed reads like rest) [physics, cite ADI F=ma]",
      "CLIMAX (KineticWord): 'Down is a sagging mass.'",
      "CLOSURE: every auto-rotate is a weight leaning a few nanometres (amount [needs source])",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) same MEMS family in step counters [needs source]",
      "(spare) gyroscope sibling",
      "(spare) ADXL first micromachined parts history",
      "(spare) PWM output"
    ],
    "score": 13,
    "pilot": false
  },
  {
    "slug": "usb-c-power",
    "title": "How USB-C decides how much power to send",
    "question": "The same USB-C cable charges earbuds and a laptop; how does the charger know not to fry the earbuds?",
    "answer": "Resistors in the charger and the device let the two sides detect each other and unlock a safe 5 V; anything higher needs a short conversation: the charger lists what it can do, the device asks for one option, and only then is the voltage raised.",
    "sources": [
      "https://www.ti.com/lit/eb/slyy228/slyy228.pdf",
      "https://www.microchip.com/content/dam/mchp/documents/OTH/ApplicationNotes/ApplicationNotes/00001974A.pdf"
    ],
    "outline": [
      "HOOK: 'Plug in USB-C: safe 5 V first, and two chips talk before anything more.'",
      "REVEAL: 'USB-C power is negotiated, not pushed.'",
      "MECHANISM 1: cold connector: 0 V on VBUS until something is attached [TI SLYY228]",
      "MECHANISM 2: CC pin: source pull-up Rp, sink pull-down Rd form a voltage divider -> attach detected [TI]",
      "MECHANISM 2b: the Rp value tells the sink how much current is allowed; source provides 5 V [TI]",
      "SECOND QUESTION: 'So how does a laptop get 20 V?'",
      "MECHANISM 3: Source_Capabilities: list of power options (PDOs) over the CC wire at 300 kbps [TI]",
      "MECHANISM 3b: GoodCRC after every message [TI]",
      "MECHANISM 4: sink sends Request for one PDO [TI]",
      "MECHANISM 5: Accept -> sink drops below 500 mA while VBUS ramps 5 V -> 20 V [TI]",
      "MECHANISM 6: PS_RDY once within ±5% -> sink may draw full power [TI]",
      "SURPRISE: the cable itself can answer: e-marker chips report cable capabilities, required for >3 A [TI]",
      "SURPRISE 2: roles can swap: a phone and a laptop can trade who charges whom [Microchip AN1974]",
      "LIMIT 1: cheap cable without e-marker caps current at 3 A [TI]",
      "LIMIT 2: if nothing offered fits, the device takes 5 V and flags a capability mismatch [TI]",
      "CLIMAX (KineticWord): 'No high voltage without asking.'",
      "CLOSURE: your earbuds never asked for 20 V, so they never got it.",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) reversible because there are two CC pins [TI]",
      "(spare) 5-20 V, 0-5 A ranges [Microchip AN1974]"
    ],
    "score": 12,
    "pilot": false,
    "note": "Protocol-heavy (the kind of topic the owner found confusing): keep it physical (voltages, resistors, the cable) and simple."
  },
  {
    "slug": "oled-pixel",
    "title": "How a single OLED pixel makes its own light",
    "question": "Why can an OLED screen show perfect black while an LCD can't?",
    "answer": "Every OLED pixel is a sandwich of ultra-thin organic layers that glows when electrons and holes meet inside it, so a black pixel is simply switched off.",
    "sources": [
      "https://www.nhk.or.jp/strl/publica/bt/en/fe0058-1.pdf",
      "https://news.lgdisplay.com/en/2023/05/display-101-24-principle-of-oled-luminescence/"
    ],
    "outline": [
      "HOOK: 'On your phone's black background, millions of pixels are completely off.'",
      "REVEAL: 'Each pixel is its own light.' [LG Display]",
      "MECHANISM 1: LCD contrast: a backlight always on behind shutters [LG Display]",
      "MECHANISM 2: OLED stack: anode, hole transport, emission layer, electron transport, cathode [NHK]",
      "MECHANISM 2b: each organic layer only 30-50 nm; whole stack a few hundred nm [NHK]",
      "SECOND QUESTION: 'But how does a layer of plastic glow?'",
      "MECHANISM 3: voltage injects electrons from the cathode and holes from the anode [NHK; LG]",
      "MECHANISM 4: they meet in the emission layer -> exciton -> drops to ground state -> photon [LG]",
      "MECHANISM 4b: colour set by the emitter molecule [Merck; NHK]",
      "MECHANISM 5: thin-film transistors under each pixel set its current (2T-1C) [Nature Comms 2020]",
      "SURPRISE: spin statistics: 25% singlet, 75% triplet excitons; phosphorescent emitters (iridium) rescue the 75% [NHK]",
      "SURPRISE 2: true black because dark pixels emit nothing [LG]",
      "LIMIT 1: organic materials age; fluorescent emitters last longer [NHK]",
      "LIMIT 2: burn-in from static UI [needs source]",
      "CLIMAX (KineticWord): 'Black means off.'",
      "CLOSURE: in dark mode, truly black pixels switch off; dark-grey ones still glow dimly.",
      "CTA: 'Follow for how everyday tech actually works.'",
      "(spare) no backlight -> thin, foldable [LG]",
      "(spare) battery saving claims [needs source]",
      "(spare) subpixel layouts [needs source]"
    ],
    "score": 11,
    "pilot": false
  }
] as CuratedTopic[]);
