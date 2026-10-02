// Câmera ortográfica isométrica (2:1) que segue o jogador, treme nos impactos e é presa à
// grade de texels para o cenário 3D pixelado não "cintilar" ao andar. O resto sub-pixel vira
// um deslocamento CSS do canvas (movimento suave mesmo com pixels grandes).
import * as THREE from 'three';
import { CAMERA, TEXELS_PER_METER } from '../config';
import { damp, type Vec2 } from '../core/math';

export class IsoCamera {
  readonly camera: THREE.OrthographicCamera;
  /** Ponto seguido (suavizado), no chão. */
  readonly focus = new THREE.Vector3();
  readonly right = new THREE.Vector3(Math.cos(CAMERA.yaw), 0, -Math.sin(CAMERA.yaw));
  readonly up = new THREE.Vector3();
  private readonly offset: THREE.Vector3;
  private shakeAmp = 0;
  private shakeT = 0;
  /** Deslocamento sub-pixel (px da baixa resolução) a aplicar no canvas. */
  readonly subpixel = { x: 0, y: 0 };
  zoom = 1;
  private viewW = 1;
  private viewH = 1;

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
    const cp = Math.cos(CAMERA.pitch);
    this.offset = new THREE.Vector3(Math.sin(CAMERA.yaw) * cp, Math.sin(CAMERA.pitch), Math.cos(CAMERA.yaw) * cp).multiplyScalar(CAMERA.distance);
    // eixo "para cima" da câmera no mundo
    const fwd = this.offset.clone().negate().normalize();
    this.up.crossVectors(this.right, fwd).normalize();
    this.camera.position.copy(this.offset);
    this.camera.lookAt(0, 0, 0);
  }

  /** Tamanho do buffer em baixa resolução (px); 1 px = 1 texel = 1/32 m. */
  resize(resW: number, resH: number): void {
    this.viewW = resW / TEXELS_PER_METER;
    this.viewH = resH / TEXELS_PER_METER;
    this.applyFrustum();
  }

  private applyFrustum(): void {
    const c = this.camera;
    c.left = -this.viewW / 2 / this.zoom;
    c.right = this.viewW / 2 / this.zoom;
    c.top = this.viewH / 2 / this.zoom;
    c.bottom = -this.viewH / 2 / this.zoom;
    c.updateProjectionMatrix();
  }

  /** Meia-diagonal do chão visível (m) — usado para os inimigos surgirem fora da tela. */
  visibleRadius(): number {
    const halfW = this.viewW / 2, halfD = this.viewH / 2 / Math.sin(CAMERA.pitch);
    return Math.hypot(halfW, halfD);
  }

  shake(amount: number): void { this.shakeAmp = Math.max(this.shakeAmp, amount); }

  /** Pula direto para o ponto (início de partida). */
  jump(p: Vec2): void { this.focus.set(p.x, 0, p.z); }

  update(dt: number, target: Vec2, lead: Vec2): void {
    const tx = target.x + lead.x * CAMERA.lookAhead, tz = target.z + lead.z * CAMERA.lookAhead;
    this.focus.x = damp(this.focus.x, tx, CAMERA.follow, dt);
    this.focus.z = damp(this.focus.z, tz, CAMERA.follow, dt);
    this.shakeT += dt;
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 1.6);
    const s = this.shakeAmp * this.shakeAmp;
    const sx = Math.sin(this.shakeT * 71.3) * s * 0.35, sy = Math.cos(this.shakeT * 57.1) * s * 0.35;

    if (Math.abs(this.zoom - 1) > 1e-4) this.applyFrustum();
    // foco no plano da câmera -> coordenadas (right, up) em texels -> arredonda
    const f = this.focus.clone().addScaledVector(this.right, sx).addScaledVector(this.up, sy);
    const texel = 1 / (TEXELS_PER_METER * this.zoom);
    const r = f.dot(this.right), u = f.dot(this.up);
    const rs = Math.round(r / texel) * texel, us = Math.round(u / texel) * texel;
    f.addScaledVector(this.right, rs - r).addScaledVector(this.up, us - u);
    this.subpixel.x = -(r - rs) / texel;
    this.subpixel.y = (u - us) / texel;
    this.camera.position.copy(f).add(this.offset);
    this.camera.lookAt(f);
    this.camera.updateMatrixWorld();
  }

  /** Projeta um ponto do mundo em px de CSS (para a mira do mouse e textos). */
  project(p: THREE.Vector3, cssW: number, cssH: number): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * cssW, y: (-v.y * 0.5 + 0.5) * cssH };
  }
}
