// Silhueta de quem está atrás de construções. As construções marcam o stencil (1) onde aparecem; os
// sprites visíveis limpam (0) onde são desenhados; um segundo passe dos sprites só desenha onde o
// stencil ainda é 1 e a profundidade diz que o sprite ficou atrás: ali entra um meio-tom quadriculado.
import * as THREE from 'three';

export const OCCLUDER_REF = 1;

/** Marca o material como "construção que esconde personagens" (escreve o stencil onde é desenhado). */
export function occluder<M extends THREE.Material>(m: M): M {
  m.stencilWrite = true;
  m.stencilRef = OCCLUDER_REF;
  m.stencilFunc = THREE.AlwaysStencilFunc;
  m.stencilZPass = THREE.ReplaceStencilOp;
  return m;
}

/** Sprites visíveis: apagam a marca onde aparecem (ninguém desenha silhueta por cima de alguém à vista). */
export function clearsOccluder<M extends THREE.Material>(m: M): M {
  m.stencilWrite = true;
  m.stencilRef = 0;
  m.stencilFunc = THREE.AlwaysStencilFunc;
  m.stencilZPass = THREE.ReplaceStencilOp;
  return m;
}

/** Passe de silhueta: só atrás (profundidade maior) e só sobre construções; não escreve nada. */
export function occludedPass<M extends THREE.Material>(m: M): M {
  m.depthFunc = THREE.GreaterDepth;
  m.depthWrite = false;
  m.stencilWrite = true; // liga o teste de stencil no three
  m.stencilWriteMask = 0;
  m.stencilRef = OCCLUDER_REF;
  m.stencilFunc = THREE.EqualStencilFunc;
  m.stencilFail = THREE.KeepStencilOp;
  m.stencilZFail = THREE.KeepStencilOp;
  m.stencilZPass = THREE.KeepStencilOp;
  return m;
}
