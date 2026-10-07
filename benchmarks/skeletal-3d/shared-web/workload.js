import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
export function skeletalWorkload(stage) {
  let renderer,
    scene,
    camera,
    mixers = [],
    handle,
    running = false,
    last,
    times = [],
    environmentTarget,
    orbitExtent = 0,
    maximum = false,
    dynamicLights = [];
  const state = {
    timings: null,
    assetSha256: null,
    assetMetadata: null,
    failure: null,
  };
  return Object.assign(state, {
    metadata() {
      return { workload_width: stage.clientWidth, workload_height: 360 };
    },
    async prepare(
      { asset = "RiggedSimple", characterCount = 1, sceneProfile = "baseline" },
      _seed,
      signal,
    ) {
      this.dispose();
      this.failure = null;
      maximum = sceneProfile === "maximum";
      dynamicLights = [];
      stage.className = "stage scene-stage";
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(devicePixelRatio);
      renderer.setSize(stage.clientWidth, stage.clientHeight);
      renderer.setClearColor("#0d1512");
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const currentRenderer = renderer;
      renderer.domElement.addEventListener("webglcontextlost", () => {
        if (renderer === currentRenderer)
          this.failure = new Error(
            "WebGL context lost; experiment invalidated",
          );
      });
      stage.append(renderer.domElement);
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xd9ffe5, 0x273127, 2.2));
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.position.set(3, 8, 5);
      scene.add(light);
      camera = new THREE.PerspectiveCamera(
        40,
        stage.clientWidth / stage.clientHeight,
        0.01,
        10000,
      );
      const stress = asset.startsWith("stress/");
      let manifest = null;
      if (stress) {
        const response = await fetch(
          `http://127.0.0.1:1490/${asset.slice(7)}.manifest.json`,
          { signal },
        );
        if (!response.ok)
          throw new Error(
            "Stress asset manifest unavailable. Start npm run assets:stress:serve.",
          );
        manifest = await response.json();
      }
      const start = performance.now();
      const url = stress
        ? `http://127.0.0.1:1490/${asset.slice(7)}.glb`
        : asset.startsWith("generated/")
          ? `./${asset}.glb`
          : `./3d/${asset}.glb`;
      const response = await fetch(url, { signal });
      if (!response.ok)
        throw new Error(
          `Asset unavailable: ${asset}. Run ${stress ? "npm run assets:stress:serve" : "npm run assets:fetch"}.`,
        );
      const bytes = await response.arrayBuffer();
      const loaded = performance.now();
      if (manifest) {
        if (
          bytes.byteLength !== manifest.size_bytes ||
          !/^[a-f0-9]{64}$/.test(manifest.sha256)
        )
          throw new Error("Stress asset/manifest mismatch");
        this.assetSha256 = manifest.sha256;
        this.assetMetadata = {
          ...manifest,
          integrity_method:
            "SHA-256 computed during generation and independently streamed verification; renderer checks length without rehashing multi-GB bytes",
          transport:
            "loopback HTTP; Cache-Control no-store; OS file cache uncontrolled",
        };
      } else {
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        this.assetSha256 = Array.from(new Uint8Array(hash), (v) =>
          v.toString(16).padStart(2, "0"),
        ).join("");
        this.assetMetadata = null;
      }
      const parseStart = performance.now();
      const gltf = await new GLTFLoader().parseAsync(bytes, "");
      const parsed = performance.now();
      if (!gltf.animations.length)
        throw new Error("Asset has no animation; animated baseline rejected");
      const box = new THREE.Box3().setFromObject(gltf.scene),
        size = box.getSize(new THREE.Vector3()),
        center = box.getCenter(new THREE.Vector3());
      const max = Math.max(size.x, size.y, size.z) || 1;
      const columns = Math.ceil(Math.sqrt(characterCount));
      for (let i = 0; i < characterCount; i++) {
        const object = clone(gltf.scene);
        object.position.sub(center);
        object.position.x += ((i % columns) - (columns - 1) / 2) * max * 1.4;
        object.position.z +=
          (Math.floor(i / columns) - (columns - 1) / 2) * max * 1.4;
        scene.add(object);
        const mixer = new THREE.AnimationMixer(object);
        mixer.clipAction(gltf.animations[0]).play();
        mixer.setTime(i * 0.037);
        mixers.push(mixer);
      }
      const extent = max * columns;
      orbitExtent = extent;
      if (maximum) {
        const hdr = await new RGBELoader().loadAsync(
          "./3d/studio_small_09_1k.hdr",
        );
        const pmrem = new THREE.PMREMGenerator(renderer);
        environmentTarget = pmrem.fromEquirectangular(hdr);
        scene.environment = environmentTarget.texture;
        hdr.dispose();
        pmrem.dispose();
        for (let i = 0; i < 3; i++) {
          const point = new THREE.PointLight(
            [0xffcc88, 0x88ccff, 0xaaff88][i],
            5,
            extent * 8,
          );
          point.position.set(
            extent * Math.cos(i * 2),
            extent,
            extent * Math.sin(i * 2),
          );
          dynamicLights.push(point);
          scene.add(point);
        }
      }
      camera.position.set(extent * 0.9, extent * 0.65, extent * 1.7);
      camera.lookAt(0, 0, 0);
      const grid = new THREE.GridHelper(extent * 3, 24, 0x426450, 0x1c3026);
      grid.position.y = -size.y / 2;
      scene.add(grid);
      const renderStart = performance.now();
      renderer.render(scene, camera);
      this.assertHealthy();
      const submitted = performance.now();
      await new Promise(requestAnimationFrame);
      const first = performance.now();
      mixers.forEach((m) => m.update(1 / 60));
      renderer.render(scene, camera);
      await new Promise(requestAnimationFrame);
      this.timings = {
        assetLoadMs: loaded - start,
        parseMs: parsed - parseStart,
        textureDecodeMs: null,
        gpuUploadMs: null,
        firstRenderSubmissionMs: submitted - renderStart,
        ttfmMs: first - start,
        ttfaMs: performance.now() - start,
        assetBytes: bytes.byteLength,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      };
      times = [];
    },
    start() {
      running = true;
      last = performance.now();
      const tick = (t) => {
        if (!running) return;
        const dt = (t - last) / 1000;
        last = t;
        const a = performance.now();
        mixers.forEach((m) => m.update(dt));
        const b = performance.now();
        if (maximum) {
          const angle = t / 5000;
          camera.position.set(
            Math.sin(angle) * orbitExtent * 1.8,
            orbitExtent * 0.65,
            Math.cos(angle) * orbitExtent * 1.8,
          );
          camera.lookAt(0, 0, 0);
          dynamicLights.forEach((light, i) =>
            light.position.set(
              Math.cos(angle + i * 2) * orbitExtent,
              orbitExtent * (0.7 + 0.3 * Math.sin(angle)),
              Math.sin(angle + i * 2) * orbitExtent,
            ),
          );
        }
        renderer.render(scene, camera);
        times.push({ animationMs: b - a, renderMs: performance.now() - b });
        handle = requestAnimationFrame(tick);
      };
      handle = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(handle);
    },
    assertHealthy() {
      if (this.failure) throw this.failure;
    },
    beginMeasurement() {
      times = [];
    },
    measurements() {
      return {
        animationSamplingMs: times.length
          ? times.reduce((s, v) => s + v.animationMs, 0) / times.length
          : null,
        boneMatrixUpdateMs: null,
        renderSubmissionMs: times.length
          ? times.reduce((s, v) => s + v.renderMs, 0) / times.length
          : null,
        skinningMs: null,
      };
    },
    dispose() {
      this.stop();
      if (scene) {
        const geometries = new Set(),
          materials = new Set(),
          textures = new Set();
        scene.traverse((o) => {
          if (o.geometry) geometries.add(o.geometry);
          for (const m of (Array.isArray(o.material)
            ? o.material
            : [o.material]
          ).filter(Boolean)) {
            materials.add(m);
            for (const value of Object.values(m))
              if (value?.isTexture) textures.add(value);
          }
        });
        geometries.forEach((g) => g.dispose());
        textures.forEach((t) => t.dispose());
        materials.forEach((m) => m.dispose());
      }
      environmentTarget?.dispose();
      environmentTarget = null;
      dynamicLights = [];
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer = null;
      scene = null;
      mixers = [];
      stage.replaceChildren();
    },
  });
}
