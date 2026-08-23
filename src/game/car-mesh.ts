import * as THREE from "three";

export function makeCar(): THREE.Group {
  const car = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xe8e0d4,
    roughness: 0.42,
    metalness: 0.12,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x1a1b1e,
    roughness: 0.35,
    metalness: 0.4,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x8a9aaa,
    roughness: 0.12,
    metalness: 0.6,
    transparent: true,
    opacity: 0.72,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.62, 3.85), bodyMat);
  body.position.set(0, 0.62, 0);
  body.castShadow = true;
  car.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.58, 1.7), glassMat);
  cabin.position.set(0, 1.12, 0.18);
  cabin.castShadow = true;
  car.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 1.55), bodyMat);
  roof.position.set(0, 1.42, 0.18);
  car.add(roof);

  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 0.22), darkMat);
  bumperF.position.set(0, 0.42, -1.95);
  car.add(bumperF);

  const bumperR = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 0.18), darkMat);
  bumperR.position.set(0, 0.42, 1.96);
  car.add(bumperR);

  const lightGeo = new THREE.BoxGeometry(0.32, 0.14, 0.08);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xf4f1ea,
    emissive: 0xfff3d6,
    emissiveIntensity: 2.4,
  });
  const hl = new THREE.Mesh(lightGeo, headMat);
  hl.position.set(-0.52, 0.58, -1.96);
  const hr = hl.clone();
  hr.position.x = 0.52;
  car.add(hl, hr);

  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x8a2a22,
    emissive: 0xff3318,
    emissiveIntensity: 0.9,
  });
  const tl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.06), tailMat);
  tl.position.set(-0.55, 0.7, 1.98);
  const tr = tl.clone();
  tr.position.x = 0.55;
  car.add(tl, tr);

  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.28, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels: THREE.Mesh[] = [];
  const positions: [number, number, number][] = [
    [-0.82, 0.32, -1.22],
    [0.82, 0.32, -1.22],
    [-0.82, 0.32, 1.28],
    [0.82, 0.32, 1.28],
  ];
  for (const [x, y, z] of positions) {
    const w = new THREE.Mesh(wheelGeo, rubber);
    w.position.set(x, y, z);
    w.castShadow = true;
    car.add(w);
    wheels.push(w);
  }
  car.userData.wheels = wheels;
  car.userData.frontWheels = wheels.slice(0, 2);
  return car;
}
