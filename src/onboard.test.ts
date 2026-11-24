// Tests for the onboarding gate and top-bar path (src/onboard.ts): which
// screen shows for a config, what a launch keeps of the remembered answers, cursor movement over the pick rows, and how a
// project path is shortened in the top bar.
import { describe, expect, it } from 'vitest';
import { moveSel, onboardStep, reconcileRemembered, shortPath } from './onboard';

describe('onboardStep', () => {
  it('asks who first, then which project', () => {
    expect(onboardStep(null, null, false)).toBe('who');
    expect(onboardStep(null, '/p', false)).toBe('who');
    expect(onboardStep('mel', null, false)).toBe('project');
    expect(onboardStep('mel', '/p', false)).toBe(null);
  });

  it('a skipped worker counts as answered', () => {
    expect(onboardStep(null, null, true)).toBe('project');
    expect(onboardStep(null, '/p', true)).toBe(null);
  });
});

describe('onboardStep when switching', () => {
  it('opens straight into the shell when both are remembered and valid', () => {
    expect(onboardStep('mel', '/p', false)).toBe(null);
  });

  it('switching worker or project asks that step again, remembered answer kept', () => {
    expect(onboardStep('mel', '/p', false, false, true)).toBe('who');
    expect(onboardStep('mel', '/p', false, true, false)).toBe('project');
  });

  it('a skipped worker still asks the project when switching it', () => {
    expect(onboardStep(null, '/p', true, true, false)).toBe('project');
  });

  it('shows only the step that is missing', () => {
    expect(onboardStep('mel', null, false)).toBe('project');
    expect(onboardStep(null, '/p', false)).toBe('who');
  });
});

describe('reconcileRemembered', () => {
  const names = ['mel', 'yuno'];
  it('keeps a remembered worker and project that are still valid', () => {
    const r = reconcileRemembered({ worker: 'mel', project: '/p', workerNames: names, projectValid: true });
    expect(r).toEqual({ worker: 'mel', project: '/p', droppedWorker: null, droppedProject: null });
  });

  it('drops a worker the stack no longer lists, keeping the project', () => {
    const r = reconcileRemembered({ worker: 'gone', project: '/p', workerNames: names, projectValid: true });
    expect(r.worker).toBe(null);
    expect(r.droppedWorker).toBe('gone');
    expect(r.project).toBe('/p');
    expect(onboardStep(r.worker, r.project, false)).toBe('who');
  });

  it('drops a project that is gone or invalid, keeping the worker', () => {
    const r = reconcileRemembered({ worker: 'mel', project: '/gone', workerNames: names, projectValid: false });
    expect(r.project).toBe(null);
    expect(r.droppedProject).toBe('/gone');
    expect(r.worker).toBe('mel');
    expect(onboardStep(r.worker, r.project, false)).toBe('project');
  });

  it('keeps a worker it cannot verify (list unreadable)', () => {
    const r = reconcileRemembered({ worker: 'mel', project: null, workerNames: null, projectValid: null });
    expect(r.worker).toBe('mel');
    expect(r.droppedWorker).toBe(null);
  });

  it('an empty worker list drops the remembered worker', () => {
    expect(reconcileRemembered({ worker: 'mel', project: null, workerNames: [], projectValid: null }).worker).toBe(null);
  });

  it('nothing remembered stays nothing', () => {
    const r = reconcileRemembered({ worker: null, project: null, workerNames: names, projectValid: null });
    expect(r).toEqual({ worker: null, project: null, droppedWorker: null, droppedProject: null });
  });
});

describe('moveSel', () => {
  it('walks the rows and stops at the ends', () => {
    expect(moveSel(0, 1, 3)).toBe(1);
    expect(moveSel(2, 1, 3)).toBe(2);
    expect(moveSel(0, -1, 3)).toBe(0);
    expect(moveSel(1, -1, 3)).toBe(0);
  });

  it('starts from the nearest end and handles empties', () => {
    expect(moveSel(-1, 1, 3)).toBe(0);
    expect(moveSel(-1, -1, 3)).toBe(2);
    expect(moveSel(-1, 1, 0)).toBe(-1);
    expect(moveSel(0, 1, 0)).toBe(-1);
  });
});

describe('shortPath', () => {
  it('keeps the last two segments of a deep path', () => {
    expect(shortPath('/home/dev/projects/folio')).toBe('…/projects/folio');
    expect(shortPath('/a/b/c')).toBe('…/b/c');
  });

  it('drops trailing slashes before shortening', () => {
    expect(shortPath('/home/dev/projects/folio/')).toBe('…/projects/folio');
    expect(shortPath('/home/dev///')).toBe('/home/dev');
  });

  it('leaves a short path as it is', () => {
    expect(shortPath('/home/dev')).toBe('/home/dev');
    expect(shortPath('/home/')).toBe('/home');
    expect(shortPath('projects/folio')).toBe('projects/folio');
  });

  it('keeps the root and handles the empty string', () => {
    expect(shortPath('/')).toBe('/');
    expect(shortPath('///')).toBe('/');
    expect(shortPath('')).toBe('');
  });

  it('accepts Windows separators', () => {
    expect(shortPath('C:\\Users\\mel\\proj\\')).toBe('…/mel/proj');
  });
});
