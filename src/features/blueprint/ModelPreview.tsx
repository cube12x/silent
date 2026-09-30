import * as React from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js"
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js"
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js"
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js"
import { TDSLoader } from "three/examples/jsm/loaders/TDSLoader.js"
import { getBackend } from "@/services"
import { useT } from "@/i18n"

export const MODEL_EXT = /\.(glb|gltf|fbx|obj|stl|ply|dae|3ds)$/i

interface Loaded {
  object: THREE.Object3D
  clips: THREE.AnimationClip[]
}

interface Stats {
  size: [number, number, number]
  vertices: number
  materials: number
}

const base = (p: string) => p.split("/").pop() ?? p
const dir = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "")

/**
 * Loads one model file plus the sibling resources it references (mtl, textures, gltf .bin) from the project through
 * the backend and resolves them for three's loaders by name — the webview has no file:// access.
 */
async function loadModel(root: string, file: string, siblings: string[]): Promise<Loaded> {
  const backend = await getBackend()
  const urls = new Map<string, string>()
  const objectUrl = async (rel: string): Promise<string | null> => {
    const blob = await backend.readProjectBlob(root, rel, 64 * 1024 * 1024)
    if (!blob) return null
    const bytes = Uint8Array.from(atob(blob.base64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: blob.mime }))
    urls.set(base(rel), url)
    urls.set(rel, url)
    return url
  }
  const main = await objectUrl(file)
  if (!main) throw new Error(`${file} not found`)
  const folder = dir(file)
  const stem = base(file).replace(/\.[^.]+$/, "")
  // Sibling resources: same folder, likely referenced (materials, textures, buffers); capped so a texture dump does not stall.
  const wanted = siblings.filter((s) => s !== file && dir(s) === folder && /\.(mtl|bin|png|jpe?g|webp|tga|bmp|gif|ktx2?|dds)$/i.test(s)).slice(0, 40)
  await Promise.all(wanted.map((s) => objectUrl(s).catch(() => null)))
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    const name = decodeURIComponent(base(url.split("?")[0]))
    return urls.get(name) ?? urls.get(url) ?? url
  })
  const ext = (file.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase()
  const asMesh = (geometry: THREE.BufferGeometry): Loaded => {
    geometry.computeVertexNormals()
    return { object: new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.1, roughness: 0.8 })), clips: [] }
  }
  try {
    switch (ext) {
      case "glb":
      case "gltf": {
        const gltf = await new GLTFLoader(manager).loadAsync(main)
        return { object: gltf.scene, clips: gltf.animations }
      }
      case "fbx": {
        const obj = await new FBXLoader(manager).loadAsync(main)
        return { object: obj, clips: obj.animations }
      }
      case "obj": {
        const mtlRel = siblings.find((s) => dir(s) === folder && base(s).toLowerCase() === `${stem.toLowerCase()}.mtl`)
        const loader = new OBJLoader(manager)
        if (mtlRel && urls.get(base(mtlRel))) {
          const mats = await new MTLLoader(manager).loadAsync(urls.get(base(mtlRel))!)
          mats.preload()
          loader.setMaterials(mats)
        }
        const obj = await loader.loadAsync(main)
        return { object: obj, clips: [] }
      }
      case "stl":
        return asMesh(await new STLLoader(manager).loadAsync(main))
      case "ply":
        return asMesh(await new PLYLoader(manager).loadAsync(main))
      case "dae": {
        const collada = await new ColladaLoader(manager).loadAsync(main)
        if (!collada) throw new Error("empty Collada document")
        return { object: collada.scene, clips: (collada.scene as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations ?? [] }
      }
      case "3ds": {
        const group = await new TDSLoader(manager).loadAsync(main)
        return { object: group, clips: [] }
      }
      default:
        throw new Error(`unsupported model format .${ext}`)
    }
  } finally {
    // Object URLs are revoked after the loaders have consumed them (textures are decoded synchronously on load end).
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 30_000)
  }
}

function statsOf(object: THREE.Object3D): Stats {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  let vertices = 0
  const materials = new Set<THREE.Material>()
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) {
      vertices += mesh.geometry.getAttribute("position")?.count ?? 0
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m)
    }
  })
  return { size: [size.x, size.y, size.z], vertices, materials: materials.size }
}

/** Interactive 3D preview (orbit, auto-rotate, wireframe) with the model's animation clips as tabs. */
export default function ModelPreview({ root, file, siblings, onClips }: { root: string; file: string; siblings: string[]; onClips?: (names: string[]) => void }) {
  const t = useT()
  const mountRef = React.useRef<HTMLDivElement>(null)
  const [state, setState] = React.useState<{ status: "loading" | "ready" | "error"; error?: string; stats?: Stats; clips: string[] }>({ status: "loading", clips: [] })
  const [clip, setClip] = React.useState<string | null>(null)
  const [rotate, setRotate] = React.useState(true)
  const [wire, setWire] = React.useState(false)
  const sceneRef = React.useRef<{ mixer?: THREE.AnimationMixer; clips: THREE.AnimationClip[]; object?: THREE.Object3D; controls?: OrbitControls; action?: THREE.AnimationAction }>({ clips: [] })

  React.useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let alive = true
    const width = mount.clientWidth || 300
    const height = 240
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    mount.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 1000)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.2))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(3, 5, 4)
    scene.add(sun)
    const grid = new THREE.GridHelper(2, 10, 0x3a4250, 0x262c36)
    scene.add(grid)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.autoRotate = true
    controls.autoRotateSpeed = 2
    sceneRef.current.controls = controls
    const clock = new THREE.Clock()
    let raf = 0
    const tick = () => {
      const dt = clock.getDelta()
      sceneRef.current.mixer?.update(dt)
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    void loadModel(root, file, siblings)
      .then(({ object, clips }) => {
        if (!alive) return
        // Frame the model: centre it on the grid, scale the camera distance to its size.
        const box = new THREE.Box3().setFromObject(object)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        object.position.sub(center)
        object.position.y += size.y / 2
        const radius = Math.max(size.x, size.y, size.z) || 1
        grid.scale.setScalar(radius)
        camera.position.set(radius * 1.6, radius * 1.1, radius * 1.8)
        camera.near = radius / 100
        camera.far = radius * 100
        camera.updateProjectionMatrix()
        controls.target.set(0, size.y / 2, 0)
        scene.add(object)
        const mixer = clips.length ? new THREE.AnimationMixer(object) : undefined
        sceneRef.current = { ...sceneRef.current, mixer, clips, object }
        const names = clips.map((c, i) => c.name || `clip ${i + 1}`)
        setState({ status: "ready", stats: statsOf(object), clips: names })
        if (clips.length && mixer) {
          const action = mixer.clipAction(clips[0])
          action.play()
          sceneRef.current.action = action
          setClip(names[0])
        }
        onClips?.(names)
      })
      .catch((e: unknown) => alive && setState({ status: "error", error: e instanceof Error ? e.message : String(e), clips: [] }))
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      controls.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      mount.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, file])

  React.useEffect(() => {
    if (sceneRef.current.controls) sceneRef.current.controls.autoRotate = rotate
  }, [rotate])
  React.useEffect(() => {
    sceneRef.current.object?.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) (m as THREE.MeshStandardMaterial).wireframe = wire
    })
  }, [wire, state.status])
  const playClip = (name: string) => {
    const { mixer, clips } = sceneRef.current
    const target = clips.find((c, i) => (c.name || `clip ${i + 1}`) === name)
    if (!mixer || !target) return
    sceneRef.current.action?.stop()
    const action = mixer.clipAction(target)
    action.reset().play()
    sceneRef.current.action = action
    setClip(name)
  }
  const s = state.stats
  return (
    <div className="flex flex-col gap-2">
      <div ref={mountRef} className="relative h-[240px] w-full overflow-hidden rounded-sm border border-line bg-ink-0">
        {state.status === "loading" && <div className="absolute inset-0 flex items-center justify-center text-[11px] text-text-3">{t("files.model.loading")}</div>}
        {state.status === "error" && <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-danger">{t("files.model.failed")}: {state.error}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-3">
        <label className="flex items-center gap-1"><input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} />{t("files.model.autoRotate")}</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={wire} onChange={(e) => setWire(e.target.checked)} />{t("files.model.wireframe")}</label>
        {s && <span className="mono ml-auto">{s.size.map((v) => v.toFixed(2)).join(" × ")} · {s.vertices.toLocaleString()} v · {s.materials} mat</span>}
      </div>
      {state.status === "ready" && (
        <div className="flex flex-wrap gap-1">
          {state.clips.length ? state.clips.map((name) => (
            <button key={name} type="button" onClick={() => playClip(name)} className={name === clip ? "rounded-sm border border-text-2 bg-ink-3 px-2 py-0.5 text-[11px] text-text-1" : "rounded-sm border border-line px-2 py-0.5 text-[11px] text-text-3 hover:text-text-1"}>{name}</button>
          )) : <span className="text-[11px] text-text-3">{t("files.model.noClips")}</span>}
        </div>
      )}
    </div>
  )
}
