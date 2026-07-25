'use strict';
/* ============================================================
   WORLD3D — Three.js renderer for Mung Daal's Catering Co.
   Low-poly cartoon style: flat Lambert colors, hemisphere +
   directional lights, inverted-hull dark outlines, procedural
   primitive rigs only. Pattern clothing uses canvas textures
   (the show's static-pattern gag, now on fabric meshes).

   Rigs are modeled to the show's canonical designs (colors/
   accessories per the Chowder wiki). All faces look down +Z,
   so setting rotation.y = atan2(dx, dz) faces movement (see
   yawToward, used by every moving rig).

   Exposes global W3; game.js calls W3.init() and W3.render().
   Falls back cleanly: if init fails, game.js uses its 2D path.
   ============================================================ */
const W3 = {
  ok: false,
  renderer: null, camera: null,
  marketScene: null, kitchenScene: null,
  animated: [],          // {g, baseY, off, rate} idle bobbers
  playerRigs: {},        // chowder / schnitzel market rigs
  customerRigs: {},      // order.id -> rig (service)
  kSchnitzel: null, kChowder: null,
  camPos: null, camLook: null,
  lastP: { x: 480, y: 415 }, // last market player pos (for facing)
  chowderLastX: 0.8,         // last kitchen-chowder x (for facing)
};

/* ---------- material / geometry helpers ---------- */
function M3(color) { return new THREE.MeshLambertMaterial({ color }); }
function M3T(tex) { return new THREE.MeshLambertMaterial({ map: tex }); }
const OUTLINE_COL = 0x231634;
function ol(mesh, s) {
  const o = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: OUTLINE_COL, side: THREE.BackSide }));
  o.scale.setScalar(s || 1.07);
  mesh.add(o);
  return mesh;
}
function box(w, h, d, color, x, y, z, noOL) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'object' ? color : M3(color));
  m.position.set(x, y, z);
  return noOL ? m : ol(m);
}
function sph(r, color, x, y, z, sx, sy, sz) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), typeof color === 'object' ? color : M3(color));
  m.position.set(x, y, z);
  if (sx !== undefined) m.scale.set(sx, sy, sz);
  return ol(m);
}
function cyl(rt, rb, h, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 12), typeof color === 'object' ? color : M3(color));
  m.position.set(x, y, z);
  return ol(m);
}
function cone(r, h, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 12), typeof color === 'object' ? color : M3(color));
  m.position.set(x, y, z);
  return ol(m);
}
function torus(r, tube, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 16), M3(color));
  m.position.set(x, y, z);
  return ol(m, 1.12);
}

/* ---------- facing: shortest-arc yaw toward a target ---------- */
const FACE_RATE = 12; // rad/s — snappy but not instant
function yawToward(rig, target, dt, rate) {
  let d = target - rig.rotation.y;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const step = (rate || FACE_RATE) * dt;
  rig.rotation.y += Math.max(-step, Math.min(step, d));
}

/* ---------- canvas pattern textures (the clothing gag) ---------- */
function patTex(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function dotsTex(bg, dot) {
  return patTex(g => {
    g.fillStyle = bg; g.fillRect(0, 0, 64, 64);
    g.fillStyle = dot;
    [[16, 16], [48, 48], [48, 16], [16, 48]].forEach(p => { g.beginPath(); g.arc(p[0], p[1], 7, 0, 7); g.fill(); });
  });
}
function kiltTex() { // Mung's green-and-red plaid kilt
  return patTex(g => {
    g.fillStyle = '#2e6b3a'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(200,60,50,0.75)'; g.fillRect(0, 0, 14, 64); g.fillRect(0, 0, 64, 14);
    g.fillStyle = 'rgba(20,30,60,0.5)'; g.fillRect(32, 0, 10, 64); g.fillRect(0, 32, 64, 10);
  });
}
function stripesTex(bg, st) {
  return patTex(g => {
    g.fillStyle = bg; g.fillRect(0, 0, 64, 64);
    g.fillStyle = st; g.fillRect(0, 0, 64, 18); g.fillRect(0, 40, 64, 10);
  });
}
function tailTex() { // Chowder's striped raccoon tail
  return stripesTex('#9a7fd0', '#6a4a9a');
}
function signTex(str, bg, fg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#231634'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 58);
  g.fillStyle = fg; g.font = 'bold 26px "Comic Sans MS", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(str, 128, 34);
  return new THREE.CanvasTexture(c);
}

/* ============================================================
   CHARACTER RIGS — canonical Chowder designs. Feet at y=0,
   face looking down +Z. Big heads, chibi proportions.
   ============================================================ */
/* Chowder: violet fur, pink nose, purple two-point hat, purple
   shirt with fuchsia trim, purple shoes, buck fang, striped tail. */
function rigChowder() {
  const g = new THREE.Group();
  const fur = 0x9a7fd0, furDark = 0x7a5ab0, shirt = 0x7a48c9;
  g.add(box(0.16, 0.1, 0.24, 0x6a38b8, -0.13, 0.05, 0.03));   // purple shoes
  g.add(box(0.16, 0.1, 0.24, 0x6a38b8, 0.13, 0.05, 0.03));
  g.add(sph(0.34, fur, 0, 0.44, 0));                          // chubby body
  g.add(sph(0.35, shirt, 0, 0.42, 0, 1, 0.8, 1));             // purple shirt
  g.add(cyl(0.3, 0.32, 0.1, 0xe85f9b, 0, 0.2, 0));            // fuchsia trim
  g.add(sph(0.1, fur, -0.3, 0.5, 0.08)); g.add(sph(0.1, fur, 0.3, 0.5, 0.08)); // arms
  g.add(sph(0.36, fur, 0, 0.98, 0));                          // BIG head
  g.add(sph(0.05, 0xe88ab0, 0, 0.98, 0.35));                  // small pink nose
  g.add(box(0.05, 0.07, 0.03, 0xffffff, 0, 0.9, 0.35));       // buck fang
  g.add(sph(0.07, 0xffffff, -0.11, 1.08, 0.3)); g.add(sph(0.07, 0xffffff, 0.11, 1.08, 0.3));
  g.add(sph(0.03, OUTLINE_COL, -0.11, 1.08, 0.36)); g.add(sph(0.03, OUTLINE_COL, 0.11, 1.08, 0.36));
  g.add(sph(0.08, 0xd9b8e8, -0.2, 0.92, 0.26)); g.add(sph(0.08, 0xd9b8e8, 0.2, 0.92, 0.26)); // cheeks
  g.add(cone(0.07, 0.14, furDark, -0.2, 1.3, 0)); g.add(cone(0.07, 0.14, furDark, 0.2, 1.3, 0)); // ear stubs under hat
  g.add(sph(0.24, 0x6a38b8, 0, 1.3, 0, 1, 0.55, 1));          // purple beanie
  g.add(cone(0.09, 0.24, 0x6a38b8, -0.15, 1.48, 0));          // hat point 1
  g.add(cone(0.09, 0.24, 0x6a38b8, 0.15, 1.48, 0));           // hat point 2
  const tail = cyl(0.07, 0.09, 0.35, M3T(tailTex()), 0, 0.3, -0.38); // striped raccoon tail
  tail.rotation.x = 0.9; g.add(tail);
  return g;
}
/* Mung Daal: blue skin, huge nose, upward handlebar mustache, bushy
   brows, glasses, white hair tuft, white chef shirt, plaid kilt. */
function rigMung() {
  const g = new THREE.Group();
  const skin = 0x7fb2f0;
  g.add(box(0.26, 0.12, 0.34, 0x6b4a2f, -0.14, 0.06, 0.04));  // brown shoes
  g.add(box(0.26, 0.12, 0.34, 0x6b4a2f, 0.14, 0.06, 0.04));
  g.add(cyl(0.09, 0.09, 0.25, 0x26202e, -0.14, 0.22, 0));     // black socks
  g.add(cyl(0.09, 0.09, 0.25, 0x26202e, 0.14, 0.22, 0));
  g.add(cyl(0.34, 0.42, 0.55, M3T(kiltTex()), 0, 0.55, 0));   // plaid kilt
  g.add(box(0.72, 0.7, 0.46, 0xf4f1e8, 0, 1.15, 0));          // white chef shirt
  g.add(box(0.1, 0.5, 0.05, 0xe3e3e3, 0, 1.15, 0.24));        // shirt placket
  const armL = cyl(0.09, 0.09, 0.55, skin, -0.44, 1.15, 0); armL.rotation.z = 0.25; g.add(armL);
  const armR = cyl(0.09, 0.09, 0.55, skin, 0.44, 1.15, 0); armR.rotation.z = -0.25; g.add(armR);
  g.add(sph(0.34, skin, 0, 1.75, 0));                         // head
  g.add(sph(0.16, 0x6ea3e8, 0.02, 1.72, 0.3));                // VERY large nose
  const musL = sph(0.13, 0xffffff, -0.16, 1.62, 0.26, 1.2, 0.4, 0.55); musL.rotation.z = 0.5; g.add(musL); // handlebar mustache
  const musR = sph(0.13, 0xffffff, 0.16, 1.62, 0.26, 1.2, 0.4, 0.55); musR.rotation.z = -0.5; g.add(musR);
  g.add(box(0.16, 0.05, 0.05, 0xffffff, -0.13, 1.9, 0.28));   // bushy eyebrows
  g.add(box(0.16, 0.05, 0.05, 0xffffff, 0.13, 1.9, 0.28));
  g.add(sph(0.055, 0xffffff, -0.13, 1.84, 0.29)); g.add(sph(0.055, 0xffffff, 0.13, 1.84, 0.29));
  g.add(sph(0.024, OUTLINE_COL, -0.13, 1.84, 0.34)); g.add(sph(0.024, OUTLINE_COL, 0.13, 1.84, 0.34));
  g.add(torus(0.09, 0.015, 0x3a3a3a, -0.13, 1.84, 0.33));     // glasses
  g.add(torus(0.09, 0.015, 0x3a3a3a, 0.13, 1.84, 0.33));
  g.add(box(0.08, 0.02, 0.02, 0x3a3a3a, 0, 1.84, 0.33));
  g.add(sph(0.09, 0xffffff, 0, 2.08, 0, 1, 0.6, 1));          // white hair tuft
  return g;
}
/* Truffles: pink-skinned mushroom pixie, purple hair, huge glasses,
   emerald eyes, green dress, dotted mushroom cap, small wings. */
function rigTruffles() {
  const g = new THREE.Group();
  const skin = 0xf2a0b8;
  g.add(box(0.12, 0.08, 0.16, 0x2e8f3a, -0.1, 0.04, 0.03));   // green shoes
  g.add(box(0.12, 0.08, 0.16, 0x2e8f3a, 0.1, 0.04, 0.03));
  g.add(cone(0.42, 0.85, 0x4aa84a, 0, 0.48, 0));              // green dress
  g.add(sph(0.22, skin, 0, 1.0, 0));                          // pink face
  g.add(sph(0.24, 0x8a5a9a, 0, 1.08, -0.04, 1, 0.7, 1));      // purple hair
  const capTex = dotsTex('#e8506e', '#ffd9e0'); capTex.repeat.set(2, 2);
  g.add(sph(0.4, M3T(capTex), 0, 1.26, 0, 1, 0.42, 1));       // dotted mushroom cap
  g.add(sph(0.05, 0x2e8f5a, -0.08, 1.0, 0.2)); g.add(sph(0.05, 0x2e8f5a, 0.08, 1.0, 0.2)); // emerald eyes
  g.add(sph(0.02, OUTLINE_COL, -0.08, 1.0, 0.24)); g.add(sph(0.02, OUTLINE_COL, 0.08, 1.0, 0.24));
  g.add(torus(0.075, 0.014, 0x3a3a3a, -0.08, 1.0, 0.21));     // huge glasses
  g.add(torus(0.075, 0.014, 0x3a3a3a, 0.08, 1.0, 0.21));
  const browL = box(0.09, 0.025, 0.02, OUTLINE_COL, -0.08, 1.1, 0.2); browL.rotation.z = -0.35; g.add(browL); // grumpy brows
  const browR = box(0.09, 0.025, 0.02, OUTLINE_COL, 0.08, 1.1, 0.2); browR.rotation.z = 0.35; g.add(browR);
  const wingL = box(0.22, 0.1, 0.02, new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }), -0.24, 0.78, -0.12, true);
  const wingR = wingL.clone(); wingR.position.x = 0.24;
  g.add(wingL); g.add(wingR);
  return g;
}
/* Schnitzel: gray rock monster, TALL rectangular head, small body,
   cube ears, elephant feet, plain white apron. */
function rigSchnitzel() {
  const g = new THREE.Group();
  const rock = 0x8b9099;
  g.add(box(0.3, 0.16, 0.4, 0x6b7078, -0.2, 0.08, 0.04));     // elephant feet
  g.add(box(0.3, 0.16, 0.4, 0x6b7078, 0.2, 0.08, 0.04));
  g.add(box(0.62, 0.6, 0.45, rock, 0, 0.5, 0));               // small body
  g.add(box(0.5, 0.55, 0.05, 0xffffff, 0, 0.48, 0.24));       // white apron
  const armL = cyl(0.11, 0.11, 0.5, rock, -0.4, 0.55, 0); armL.rotation.z = 0.2; g.add(armL);
  const armR = cyl(0.11, 0.11, 0.5, rock, 0.4, 0.55, 0); armR.rotation.z = -0.2; g.add(armR);
  g.add(sph(0.12, rock, -0.46, 0.28, 0)); g.add(sph(0.12, rock, 0.46, 0.28, 0)); // bean fingers
  g.add(box(0.68, 0.95, 0.55, rock, 0, 1.35, 0));             // TALL rectangular head
  g.add(box(0.14, 0.14, 0.14, rock, -0.2, 1.9, 0));           // cube ear L
  g.add(box(0.14, 0.14, 0.14, rock, 0.2, 1.9, 0));            // cube ear R
  g.add(box(0.2, 0.06, 0.04, 0x6b7078, -0.18, 1.15, -0.28));  // rock cracks (back of head)
  g.add(box(0.14, 0.05, 0.04, 0x6b7078, 0.2, 1.55, -0.28));
  g.add(sph(0.06, 0xffffff, -0.14, 1.5, 0.28)); g.add(sph(0.06, 0xffffff, 0.14, 1.5, 0.28));
  g.add(sph(0.026, OUTLINE_COL, -0.14, 1.5, 0.33)); g.add(sph(0.026, OUTLINE_COL, 0.14, 1.5, 0.33));
  g.add(box(0.24, 0.05, 0.04, OUTLINE_COL, 0, 1.25, 0.28));   // flat mouth
  return g;
}
/* Gazpacho: BROWN woolly mammoth, trunk, small tusks, fur tufts, apron. */
function rigGazpacho() {
  const g = new THREE.Group();
  const fur = 0x8a5a34, furDark = 0x6e4526;
  g.add(sph(0.55, fur, 0, 0.85, 0, 1.15, 1.1, 1));            // big woolly body
  g.add(sph(0.18, furDark, -0.15, 1.42, -0.1, 1, 0.6, 1));    // fur tuft
  g.add(sph(0.16, furDark, 0.12, 1.45, -0.12, 1, 0.55, 1));
  g.add(sph(0.2, fur, -0.52, 1.2, 0, 1, 1.2, 0.6));           // ears
  g.add(sph(0.2, fur, 0.52, 1.2, 0, 1, 1.2, 0.6));
  const trunk1 = cyl(0.1, 0.12, 0.4, furDark, 0, 1.1, 0.42); trunk1.rotation.x = 0.5; g.add(trunk1);
  const trunk2 = cyl(0.07, 0.09, 0.3, furDark, 0, 0.82, 0.52); trunk2.rotation.x = 0.15; g.add(trunk2);
  const tuskL = cone(0.07, 0.24, 0xfff2d9, -0.22, 1.02, 0.44); tuskL.rotation.x = 0.8; g.add(tuskL);
  const tuskR = cone(0.07, 0.24, 0xfff2d9, 0.22, 1.02, 0.44); tuskR.rotation.x = 0.8; g.add(tuskR);
  g.add(sph(0.06, 0xffffff, -0.18, 1.3, 0.42)); g.add(sph(0.06, 0xffffff, 0.18, 1.3, 0.42));
  g.add(sph(0.026, OUTLINE_COL, -0.18, 1.3, 0.47)); g.add(sph(0.026, OUTLINE_COL, 0.18, 1.3, 0.47));
  g.add(box(0.6, 0.55, 0.06, M3T(dotsTex('#7a5230', '#b98a5a')), 0, 0.6, 0.52)); // apron
  g.add(box(0.28, 0.12, 0.36, furDark, -0.24, 0.06, 0.04));
  g.add(box(0.28, 0.12, 0.36, furDark, 0.24, 0.06, 0.04));
  return g;
}
/* Ms. Endive: gargantuan, orange skin, GREEN hair, long aardvark
   nose, green dress, jewelry. ("Martha Stewart w/ Oompa-Loompa colors") */
function rigEndive() {
  const g = new THREE.Group();
  const skin = 0xf0a23d;
  g.add(cone(0.72, 1.5, 0x2e8f3a, 0, 0.75, 0));               // big green dress
  const neckl = torus(0.2, 0.03, 0xffd94a, 0, 1.38, 0.12); neckl.rotation.x = 0.4; g.add(neckl); // gold necklace
  g.add(cyl(0.16, 0.2, 0.45, skin, 0, 1.55, 0));              // neck
  g.add(sph(0.32, skin, 0, 1.95, 0));                         // head
  const nose = cone(0.08, 0.55, skin, 0.3, 1.9, 0.28); nose.rotation.z = -1.25; g.add(nose); // long aardvark nose
  g.add(sph(0.28, 0x3aa83a, 0, 2.24, -0.05, 1, 0.7, 1));      // GREEN hair
  g.add(sph(0.14, 0x3aa83a, 0.2, 2.14, -0.08));               // hair bun
  g.add(sph(0.05, 0xffffff, -0.11, 2.0, 0.28)); g.add(sph(0.022, OUTLINE_COL, -0.11, 2.0, 0.32));
  const lash = box(0.08, 0.02, 0.02, OUTLINE_COL, -0.16, 2.06, 0.27); lash.rotation.z = 0.4; g.add(lash); // eyelashes
  g.add(sph(0.04, 0xffd94a, -0.3, 1.9, 0.05)); g.add(sph(0.04, 0xffd94a, 0.3, 1.9, 0.05)); // earrings
  g.add(box(0.2, 0.04, 0.04, OUTLINE_COL, 0.12, 1.76, 0.28)); // smug mouth
  return g;
}
/* Panini: pink lagomorphic cat-bear-rabbit, giant ears tied with a
   yellow holder, yellow dress with green heart + polka dots, lashes. */
function rigPanini() {
  const g = new THREE.Group();
  const fur = 0xf2a0c4;
  g.add(box(0.13, 0.08, 0.18, 0xd980a8, -0.1, 0.04, 0.03));
  g.add(box(0.13, 0.08, 0.18, 0xd980a8, 0.1, 0.04, 0.03));
  g.add(cone(0.36, 0.6, M3T(dotsTex('#f7c948', '#7ec96a')), 0, 0.42, 0)); // yellow dress, green dots
  g.add(sph(0.09, 0x3aa83a, 0, 0.42, 0.3, 1, 0.9, 0.5));      // green heart
  g.add(sph(0.24, fur, 0, 0.5, 0));                           // body
  g.add(sph(0.3, fur, 0, 0.95, 0));                           // BIG head
  const earL = sph(0.13, fur, -0.24, 1.42, 0, 0.7, 1.6, 0.5); earL.rotation.z = 0.25; g.add(earL); // giant round ears
  const earR = sph(0.13, fur, 0.24, 1.42, 0, 0.7, 1.6, 0.5); earR.rotation.z = -0.25; g.add(earR);
  g.add(box(0.16, 0.08, 0.1, 0xf7c948, 0, 1.22, 0));          // yellow ponytail holder
  g.add(sph(0.07, 0xffffff, -0.11, 0.98, 0.25)); g.add(sph(0.07, 0xffffff, 0.11, 0.98, 0.25));
  g.add(sph(0.03, 0x5a2a44, -0.11, 0.98, 0.31)); g.add(sph(0.03, 0x5a2a44, 0.11, 0.98, 0.31));
  const lashL = box(0.07, 0.02, 0.02, OUTLINE_COL, -0.17, 1.04, 0.25); lashL.rotation.z = 0.45; g.add(lashL);
  const lashR = box(0.07, 0.02, 0.02, OUTLINE_COL, 0.17, 1.04, 0.25); lashR.rotation.z = -0.45; g.add(lashR);
  g.add(sph(0.035, 0xd9648f, 0, 0.9, 0.29));                  // little nose
  return g;
}
/* Generic customers: bright storybook palette, big heads. */
const CUST_COLS3 = [0xe86a5a, 0x5ab8e8, 0x7ec96a, 0xe8c95a, 0xb88ae8, 0xe89ab0, 0x6ad0c0, 0xd99a4e];
function rigCustomer(seed) {
  const g = new THREE.Group();
  const c = CUST_COLS3[seed % CUST_COLS3.length];
  g.add(box(0.14, 0.08, 0.2, 0x444444, -0.1, 0.04, 0.02));
  g.add(box(0.14, 0.08, 0.2, 0x444444, 0.1, 0.04, 0.02));
  g.add(box(0.5, 0.55, 0.38, c, 0, 0.45, 0));
  g.add(sph(0.3, 0xffe0bd, 0, 1.0, 0));                       // big head
  if (seed % 3 === 0) g.add(box(0.3, 0.16, 0.3, c, 0, 1.26, 0));
  else g.add(sph(0.12, 0x6b4a2f, 0, 1.24, 0, 1, 0.5, 1));
  g.add(sph(0.05, 0xffffff, -0.1, 1.02, 0.26)); g.add(sph(0.05, 0xffffff, 0.1, 1.02, 0.26));
  g.add(sph(0.022, OUTLINE_COL, -0.1, 1.02, 0.3)); g.add(sph(0.022, OUTLINE_COL, 0.1, 1.02, 0.3));
  return g;
}
function rigFor(sp) {
  if (sp === 'mung') return rigMung();
  if (sp === 'truffles') return rigTruffles();
  if (sp === 'schnitzel') return rigSchnitzel();
  if (sp === 'chowder') return rigChowder();
  if (sp === 'gazpacho') return rigGazpacho();
  if (sp === 'endive') return rigEndive();
  if (sp === 'panini') return rigPanini();
  return rigCustomer(2);
}

/* ---------- scenes ---------- */
function addLights(scene, skyCol, groundCol) {
  scene.add(new THREE.HemisphereLight(skyCol, groundCol, 0.95));
  const d = new THREE.DirectionalLight(0xfff2d9, 0.65);
  d.position.set(5, 10, 6);
  scene.add(d);
}
function buildMarketScene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x8ad4f4);
  s.fog = new THREE.Fog(0x8ad4f4, 18, 40);
  addLights(s, 0xcfe8ff, 0x9a7ab8);
  // ground + plaza
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), M3(0x8a6aa8));
  ground.rotation.x = -Math.PI / 2; s.add(ground);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(9, 24), M3(0x9a7ab8));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.01; s.add(plaza);
  // buildings backdrop
  const bCols = [0xe89ab0, 0x7ec96a, 0xe8c95a, 0x5ab8e8, 0xe89ab0, 0x7ec96a, 0xe8c95a];
  for (let i = 0; i < 7; i++) {
    const bx = -13 + i * 4.3, bh = 2.5 + (i % 3) * 1.2;
    s.add(box(3.4, bh, 2.5, bCols[i], bx, bh / 2, -8.5));
    s.add(box(0.7, 0.8, 0.1, 0xfdf6e3, bx - 0.8, bh * 0.6, -7.2, true));
    s.add(box(0.7, 0.8, 0.1, 0xfdf6e3, bx + 0.8, bh * 0.6, -7.2, true));
  }
  // stalls (world x mirrors the 2D logic x)
  const stallCols = [0xd64545, 0x2e8f86, 0x7a48a3, 0xe8a23d];
  const names = ["Mevel's Basics", 'Grub Hub', "Fiona's Fancy", "Gazpacho's"];
  G.stalls.forEach((st, i) => {
    const wx = (st.x - 480) / 40;
    const grp = new THREE.Group();
    grp.add(box(2.4, 0.75, 1.0, 0xc98a4a, 0, 0.38, 0));                 // counter
    grp.add(cyl(0.06, 0.06, 2.6, 0x7a5230, -1.05, 1.3, -0.3));
    grp.add(cyl(0.06, 0.06, 2.6, 0x7a5230, 1.05, 1.3, -0.3));
    grp.add(box(2.6, 0.14, 1.3, stallCols[i % 4], 0, 2.6, -0.2));       // canopy
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5),
      new THREE.MeshBasicMaterial({ map: signTex(names[i], '#fdf6e3', '#b8433a') }));
    sign.position.set(0, 0.42, 0.52); grp.add(sign);                    // sign on counter front
    const vend = st.id === 'gazpacho' ? rigGazpacho() : rigCustomer(st.vendorSeed);
    vend.position.set(0, 0, -0.55); vend.scale.setScalar(1.12); grp.add(vend);
    W3.animated.push({ g: vend, baseY: 0, off: i * 1.3, rate: 2 });
    grp.position.set(wx, 0, -2.4);
    s.add(grp);
  });
  // start-service gate
  const gate = new THREE.Group();
  gate.add(box(0.35, 3.0, 0.35, 0xb8433a, -1.1, 1.5, 0));
  gate.add(box(0.35, 3.0, 0.35, 0xb8433a, 1.1, 1.5, 0));
  gate.add(box(2.8, 0.5, 0.4, 0xb8433a, 0, 3.1, 0));
  const gsign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.55),
    new THREE.MeshBasicMaterial({ map: signTex('START SERVICE', '#b8433a', '#ffd94a') }));
  gsign.position.set(0, 2.45, 0.25); gate.add(gsign);
  const mungG = rigMung(); mungG.position.set(1.9, 0, 0.3); gate.add(mungG);
  W3.animated.push({ g: mungG, baseY: 0, off: 0.5, rate: 2 });
  gate.position.set(10.6, 0, 0.5);
  s.add(gate);
  // player rigs (visibility toggled)
  W3.playerRigs.chowder = rigChowder();
  W3.playerRigs.schnitzel = rigSchnitzel();
  W3.playerRigs.schnitzel.scale.setScalar(0.85);
  s.add(W3.playerRigs.chowder); s.add(W3.playerRigs.schnitzel);
  return s;
}
function buildKitchenScene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0xf7e8c9);
  addLights(s, 0xfff2d9, 0xa83a34);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), M3(0xa83a34));
  floor.rotation.x = -Math.PI / 2; s.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), M3(0xf2dfae));
  wall.position.set(0, 6, -6); s.add(wall);
  W3.kFloor = floor; W3.kWall = wall; // re-tinted per phase in W3.render
  // long counter
  s.add(box(11, 1.0, 1.2, 0xf4f1e8, 0, 0.5, -1.6));
  s.add(box(11.3, 0.14, 1.4, 0x8a2f2a, 0, 1.05, -1.6));
  // oven with glowing window
  s.add(box(1.7, 1.9, 1.2, 0x5a5566, -4.6, 0.95, -4.2));
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.7), new THREE.MeshBasicMaterial({ color: 0xffb35a }));
  win.position.set(-4.6, 1.1, -3.59); s.add(win);
  // pots + plate props on counter
  s.add(cyl(0.35, 0.3, 0.4, 0x6a4a7a, -1.5, 1.3, -1.6));
  s.add(cyl(0.28, 0.24, 0.32, 0x2e8f86, 1.2, 1.26, -1.6));
  s.add(cyl(0.4, 0.4, 0.06, 0xffffff, 3.0, 1.15, -1.6));
  // wall shelves
  s.add(box(3.2, 0.12, 0.6, 0x7a5230, 3.4, 3.4, -5.7));
  s.add(cyl(0.22, 0.18, 0.35, 0xd64545, 2.6, 3.65, -5.7));
  s.add(cyl(0.2, 0.16, 0.3, 0xe8c95a, 3.6, 3.6, -5.7));
  s.add(box(3.2, 0.12, 0.6, 0x7a5230, -3.2, 3.4, -5.7));
  s.add(cyl(0.2, 0.16, 0.3, 0x5ab8e8, -3.4, 3.6, -5.7));
  // crew
  const mung = rigMung(); mung.position.set(-2.6, 0, -3.0); s.add(mung);
  const tru = rigTruffles(); tru.position.set(3.6, 0, -2.6); s.add(tru);
  W3.kChowder = rigChowder(); W3.kChowder.position.set(0.8, 0, -0.4); s.add(W3.kChowder);
  W3.kSchnitzel = rigSchnitzel(); W3.kSchnitzel.position.set(-4.6, 0, -2.2); W3.kSchnitzel.visible = false;
  s.add(W3.kSchnitzel);
  W3.animated.push({ g: mung, baseY: 0, off: 0, rate: 2 });
  W3.animated.push({ g: tru, baseY: 0, off: 1.1, rate: 2.6 });
  W3.animated.push({ g: W3.kChowder, baseY: 0, off: 2.2, rate: 3.4 });
  return s;
}

/* ---------- per-frame sync with game state ---------- */
function syncMarket(t, dt) {
  const p = G.player;
  const wx = (p.x - 480) / 40, wz = (p.y - 415) / 40;
  const rig = p.char === 'chowder' ? W3.playerRigs.chowder : W3.playerRigs.schnitzel;
  const other = p.char === 'chowder' ? W3.playerRigs.schnitzel : W3.playerRigs.chowder;
  rig.visible = true; other.visible = false;
  // movement facing: yaw toward the walk direction, keep heading when idle
  const dx = p.x - W3.lastP.x, dy = p.y - W3.lastP.y;
  if (dx * dx + dy * dy > 0.01) {
    // 2D +y maps to world +z; rigs are authored facing +z
    yawToward(rig, Math.atan2(dx, dy), dt);
    // keep the parked rig's heading in sync for clean Tab switches
    other.rotation.y = rig.rotation.y;
  }
  W3.lastP.x = p.x; W3.lastP.y = p.y;
  rig.position.set(wx, Math.abs(Math.sin(p.walk)) * 0.08, wz);
  // camera follows
  W3.camPos.set(wx * 0.85, 7.2, wz + 8.6);
  W3.camLook.set(wx * 0.85, 0.8, wz - 1.5);
}
function syncService() {
  // customer rigs for active orders
  const seen = {};
  const act = G.orders.filter(o => o.state === 'waiting' || o.state === 'cooking');
  act.forEach((o, i) => {
    seen[o.id] = true;
    if (!W3.customerRigs[o.id]) {
      const r = rigCustomer(o.seed);
      W3.kitchenScene.add(r);
      W3.customerRigs[o.id] = r;
      W3.animated.push({ g: r, baseY: 0, off: i * 0.9, rate: 2.2 });
    }
    W3.customerRigs[o.id].position.set(-3.6 + i * 1.9, W3.customerRigs[o.id].position.y, 1.6);
    W3.customerRigs[o.id].visible = true;
  });
  for (const id of Object.keys(W3.customerRigs)) {
    if (!seen[id]) {
      W3.kitchenScene.remove(W3.customerRigs[id]);
      W3.animated = W3.animated.filter(a => a.g !== W3.customerRigs[id]);
      delete W3.customerRigs[id];
    }
  }
  W3.kSchnitzel.visible = G.upgrades.schnitzel > 0;
  W3.camPos.set(0, 4.4, 8.8);
  W3.camLook.set(0, 1.1, -0.5);
}
function syncMorning(t, dt) {
  for (const id of Object.keys(W3.customerRigs)) W3.customerRigs[id].visible = false;
  W3.kSchnitzel.visible = false;
  const nx = 0.8 + Math.sin(t * 0.9) * 0.7; // Chowder can't stand still
  const dx = nx - W3.chowderLastX;
  if (Math.abs(dx) > 0.0001) yawToward(W3.kChowder, dx > 0 ? Math.PI / 2 : -Math.PI / 2, dt);
  W3.chowderLastX = nx;
  W3.kChowder.position.x = nx;
  W3.camPos.set(0, 3.4, 7.6);
  W3.camLook.set(0, 1.15, -1);
}
function syncOrbit(t) {
  for (const id of Object.keys(W3.customerRigs)) W3.customerRigs[id].visible = false;
  W3.kSchnitzel.visible = G.upgrades.schnitzel > 0;
  const a = t * 0.18;
  W3.camPos.set(Math.sin(a) * 8.5, 4.0, Math.cos(a) * 8.5);
  W3.camLook.set(0, 1.0, -0.5);
}

/* ---------- public API ---------- */
W3.init = function (canvas) {
  try {
    if (typeof THREE === 'undefined') return false;
    W3.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    W3.renderer.setSize(960, 600, false);
    W3.renderer.setPixelRatio(1);
    W3.camera = new THREE.PerspectiveCamera(55, 960 / 600, 0.1, 100);
    W3.camPos = new THREE.Vector3(0, 4, 9);
    W3.camLook = new THREE.Vector3(0, 1, 0);
    W3.kitchenScene = buildKitchenScene();
    W3.marketScene = null; // built on first market visit (needs G.stalls)
    W3.ok = true;
    return true;
  } catch (e) {
    W3.ok = false;
    return false;
  }
};
W3.render = function (dt, t) {
  if (!W3.ok) return;
  const phase = G.screen;
  if (phase === 'market') {
    if (!W3.marketScene) W3.marketScene = buildMarketScene(); // stalls exist by now
    syncMarket(t, dt);
    W3.scene = W3.marketScene;
  } else {
    W3.scene = W3.kitchenScene;
    if (phase === 'service') syncService();
    else if (phase === 'morning') syncMorning(t, dt);
    else syncOrbit(t); // title / help / evening orbit
    // phase-tinted backdrop + mood lighting on walls/floor
    const evening = phase !== 'service' && phase !== 'morning';
    W3.kitchenScene.background.setHex(phase === 'service' ? 0xf7e8c9 : phase === 'morning' ? 0xffd98a : 0x3a2a5a);
    W3.kWall.material.color.setHex(evening ? 0x51407a : phase === 'morning' ? 0xffe0a8 : 0xf2dfae);
    W3.kFloor.material.color.setHex(evening ? 0x38294e : 0xa83a34);
  }
  // idle bob animation
  for (const a of W3.animated) {
    if (a.g.visible) a.g.position.y = a.baseY + Math.abs(Math.sin(t * a.rate + a.off)) * 0.05;
  }
  W3.camera.position.lerp(W3.camPos, Math.min(1, dt * 5 + 0.02));
  W3.camera.lookAt(W3.camLook);
  W3.renderer.render(W3.scene, W3.camera);
};
