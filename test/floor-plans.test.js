const test = require('node:test'), assert = require('node:assert/strict');
const F = require('../property-floor-plans.js');

test('indoor location reads naturally from whichever parts are filled in', () => {
  assert.equal(F.indoorText({ indoor_building: 'B', indoor_floor: '2', indoor_suite: '210', indoor_room: 'Mechanical room' }), 'Building B, Floor 2, Suite 210, Mechanical room');
  assert.equal(F.indoorText({ indoor_building: 'Tower Building', indoor_floor: 'Basement' }), 'Tower Building, Basement');
  assert.equal(F.indoorText({ indoor_suite: 'Unit 4' }), 'Unit 4');
  assert.equal(F.indoorText({}), '');
  assert.equal(F.planLabel({ building: 'B', floor: '2' }), 'Building B, Floor 2');
  assert.equal(F.planLabel({ building: null, floor: 'Roof' }), 'Roof');
});

test('indoor location input is cleaned and the pin must be on the plan', () => {
  const v = F.cleanIndoor({ indoor_building: '  B ', indoor_floor: 2, indoor_suite: '', floor_plan_id: '7', floor_plan_x: '0.256789', floor_plan_y: '0.5' });
  assert.deepEqual(v, { indoor_building: 'B', indoor_floor: '2', indoor_suite: null, indoor_room: null, floor_plan_id: 7, floor_plan_x: 0.25679, floor_plan_y: 0.5 });
  assert.equal(F.cleanIndoor({ floor_plan_id: '7' }).floor_plan_x, null, 'a plan without a pin is allowed');
  assert.throws(() => F.cleanIndoor({ floor_plan_id: '7', floor_plan_x: '1.5', floor_plan_y: '0.2' }), /pin/);
  assert.throws(() => F.cleanIndoor({ floor_plan_id: 'abc' }), /floor plan/);
  assert.equal(F.hasIndoor({ note: 'x' }), false); assert.equal(F.hasIndoor({ indoor_room: 'Lobby' }), true); assert.equal(F.hasIndoor({ floor_plan_id: '3' }), true);
});
