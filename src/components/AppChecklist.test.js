import { projectHasFirebase } from './AppChecklist';

jest.mock('../firebase', () => ({ db: {} }));

test('Mission Control shows the Security & Ops checklist (it runs on Firebase)', () => {
  expect(projectHasFirebase({ id: 'mission-control-1786094986533' })).toBe(true);
});

test('known Firebase apps keep their checklist', () => {
  ['familythread-1785694508315', 'flarepad', 'dal-website', 'familywatch-abc'].forEach((id) => {
    expect(projectHasFirebase({ id })).toBe(true);
  });
});

test('non-Firebase projects do not', () => {
  expect(projectHasFirebase({ id: 'dal-crm-1788456655252' })).toBe(false);
  expect(projectHasFirebase({})).toBe(false);
});
