import * as THREE from "three";

// Minimal loader for the specific COLLADA flavor produced by the "Lindwurm
// Voxel Collada exporter" (single mesh, Z-up, positions+normals, one
// triangle-only <polylist> per material) — not a general-purpose COLLADA
// loader, just enough to read this shape. The skin data is "rigid": every
// vertex belongs to exactly one joint at weight 1 (classic Minecraft-style
// voxel rigging, no blending). That means real GPU skinning is unnecessary
// — each vertex can simply be reparented once into its owning joint's
// local space as a small mesh, after which ordinary Three.js scene-graph
// transforms on the bones pose it correctly.
export async function loadRiggedVoxel(url) {
  const text = await (await fetch(url)).text();
  const xml = new DOMParser().parseFromString(text, "application/xml");
  const q = (sel, root = xml) => root.querySelector(sel);
  const qa = (sel, root = xml) => [...root.querySelectorAll(sel)];

  function floatArray(id) {
    return q(`[id="${id}"]`).textContent.trim().split(/\s+/).map(Number);
  }
  // COLLADA source here is Z-up; Three.js is Y-up.
  function zUpToYUp(x, y, z) { return [x, z, -y]; }

  // material id -> effect id -> diffuse color
  const materialToEffect = new Map();
  qa("library_materials > material").forEach((m) => {
    materialToEffect.set(m.getAttribute("id"), q("instance_effect", m).getAttribute("url").replace("#", ""));
  });
  const effectDiffuse = new Map();
  qa("library_effects > effect").forEach((e) => {
    const c = q("diffuse > color", e);
    if (!c) return;
    const [r, g, b] = c.textContent.trim().split(/\s+/).map(Number);
    effectDiffuse.set(e.getAttribute("id"), new THREE.Color(r, g, b));
  });

  const meshEl = q("library_geometries > geometry > mesh");
  const positions = floatArray(q('source[id$="-positions"] float_array', meshEl).getAttribute("id"));
  const normals = floatArray(q('source[id$="-normals"] float_array', meshEl).getAttribute("id"));
  const vertCount = positions.length / 3;

  // ---------- Skeleton: one Object3D per joint, matching the visual
  // scene's node hierarchy and bind-pose local matrices. Every bind
  // matrix here is a pure translation (no rotation/scale), so reading
  // the translation column straight off is sufficient.
  const skinEl = q("library_controllers controller skin");
  const jointNames = q('source[id$="-joints"] Name_array', skinEl).textContent.trim().split(/\s+/);

  const boneById = new Map(); // node id ("Bone_000") -> THREE.Object3D
  function buildBone(nodeEl) {
    const m = q(":scope > matrix", nodeEl).textContent.trim().split(/\s+/).map(Number);
    const [tx, ty, tz] = zUpToYUp(m[3], m[7], m[11]);
    const bone = new THREE.Object3D();
    bone.position.set(tx, ty, tz);
    bone.name = nodeEl.getAttribute("name");
    boneById.set(nodeEl.getAttribute("id"), bone);
    qa(":scope > node", nodeEl).forEach((child) => bone.add(buildBone(child)));
    return bone;
  }
  const armatureRoot = q('library_visual_scenes node[id="Armature"]');
  const skeletonRoot = new THREE.Group();
  qa(":scope > node", armatureRoot).forEach((topBone) => skeletonRoot.add(buildBone(topBone)));
  skeletonRoot.updateMatrixWorld(true);

  const jointWorldInverse = jointNames.map((name) => boneById.get(name).matrixWorld.clone().invert());

  // ---------- Per-vertex joint assignment (rigid: one joint, weight 1) ----------
  const vPairs = q("vertex_weights v", skinEl).textContent.trim().split(/\s+/).map(Number);
  const vertexJoint = new Int32Array(vertCount);
  for (let i = 0; i < vertCount; i++) vertexJoint[i] = vPairs[i * 2];

  // ---------- Bucket triangle corners by (material, joint), converting
  // each vertex into its joint's local space, then build one flat-shaded
  // non-indexed geometry per bucket and parent it under that joint.
  const buckets = new Map();
  qa("polylist", meshEl).forEach((poly) => {
    const count = parseInt(poly.getAttribute("count"), 10);
    if (count === 0) return; // empty placeholder groups the exporter leaves behind
    const inputs = qa("input", poly);
    const vOffset = +inputs.find((i) => i.getAttribute("semantic") === "VERTEX").getAttribute("offset");
    const nOffset = +inputs.find((i) => i.getAttribute("semantic") === "NORMAL").getAttribute("offset");
    const stride = Math.max(...inputs.map((i) => +i.getAttribute("offset"))) + 1;
    const p = q("p", poly).textContent.trim().split(/\s+/).map(Number);
    const matId = poly.getAttribute("material");
    const color = effectDiffuse.get(materialToEffect.get(matId)) || new THREE.Color(0xffffff);

    for (let tri = 0; tri < count; tri++) {
      for (let corner = 0; corner < 3; corner++) {
        const base = (tri * 3 + corner) * stride;
        const vi = p[base + vOffset], ni = p[base + nOffset];
        const joint = vertexJoint[vi];
        const key = matId + "|" + joint;
        let b = buckets.get(key);
        if (!b) { b = { positions: [], normals: [], color, joint }; buckets.set(key, b); }
        const [px, py, pz] = zUpToYUp(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
        const local = new THREE.Vector3(px, py, pz).applyMatrix4(jointWorldInverse[joint]);
        b.positions.push(local.x, local.y, local.z);
        const [nx, ny, nz] = zUpToYUp(normals[ni * 3], normals[ni * 3 + 1], normals[ni * 3 + 2]);
        // Bind matrices are pure translations, so direction vectors are
        // unaffected by the inverse — no normal-matrix correction needed.
        b.normals.push(nx, ny, nz);
      }
    }
  });

  for (const b of buckets.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(b.positions), 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(b.normals), 3));
    const mat = new THREE.MeshStandardMaterial({
      color: b.color, roughness: 0.85,
      emissive: b.color.clone().multiplyScalar(0.35), emissiveIntensity: 0.6,
    });
    boneById.get(jointNames[b.joint]).add(new THREE.Mesh(geo, mat));
  }

  const box = new THREE.Box3().setFromObject(skeletonRoot);
  const height = box.max.y - box.min.y;
  skeletonRoot.position.y -= box.min.y;
  skeletonRoot.updateMatrixWorld(true);

  return { root: skeletonRoot, boneById, height };
}

// Deep-clones a rigged voxel hierarchy for a fresh monster instance,
// giving every mesh its own material clone so per-instance effects (hit
// flash, etc.) never bleed across instances sharing the same template.
export function cloneRiggedVoxel(root) {
  const clone = root.clone(true);
  clone.traverse((obj) => {
    if (obj.isMesh) obj.material = obj.material.clone();
  });
  return clone;
}
