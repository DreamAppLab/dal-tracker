import { projectHasFirebase } from './AppChecklist';

jest.mock('../firebase', () => ({ db: {} }));

test('Mission Control shows the Security & Ops checklist (it runs on Firebase)', () => {
  expect(projectHasFirebase({ id: 'mission-control-1786094986533' })).toBe(true);
  expect(projectHasFirebase({ id: 'mission-control' })).toBe(true);
});

test('every previously supported Firebase app keeps its checklist', () => {
  [
    'familythread', 'familythread-1785694508315', 'familylens', 'familywatch',
    'flarepad', 'logabode', 'dal-website', 'shady-duck',
    'familythread-xyz', 'familylens-2', 'familywatch-8b302',
  ].forEach((id) => {
    expect(projectHasFirebase({ id })).toBe(true);
  });
});

test('non-Firebase projects do not', () => {
  expect(projectHasFirebase({ id: 'dal-crm-1788456655252' })).toBe(false);
  expect(projectHasFirebase({ id: 'nasa-mission-control-site-1' })).toBe(false);
  expect(projectHasFirebase({ id: 'mission-control-v2' })).toBe(false);
  expect(projectHasFirebase({})).toBe(false);
});
