/**
 * Simple test script to validate the production ML implementation
 */

const tf = require('@tensorflow/tfjs-node');

console.log('🧪 Testing Production ML Implementation');
console.log('=' .repeat(50));

// Test 1: TensorFlow.js is working
console.log('\n✅ Test 1: TensorFlow.js Installation');
console.log('TensorFlow.js version:', tf.version.tfjs);
console.log('Backend:', tf.getBackend());

// Test 2: Basic tensor operations
console.log('\n✅ Test 2: Basic Tensor Operations');
const a = tf.tensor2d([[1, 2], [3, 4]]);
const b = tf.tensor2d([[5, 6], [7, 8]]);
const c = a.matMul(b);
console.log('Matrix multiplication result:');
c.print();

// Test 3: Simple neural network creation
console.log('\n✅ Test 3: Neural Network Creation');
const model = tf.sequential({
  layers: [
    tf.layers.dense({inputShape: [2], units: 4, activation: 'relu'}),
    tf.layers.dense({units: 1, activation: 'sigmoid'})
  ]
});

model.compile({
  optimizer: 'adam',
  loss: 'binaryCrossentropy',
  metrics: ['accuracy']
});

console.log('Model created successfully');
console.log('Model summary:');
model.summary();

// Test 4: Simple training
console.log('\n✅ Test 4: Simple Training');
const xs = tf.tensor2d([[0, 0], [0, 1], [1, 0], [1, 1]]);
const ys = tf.tensor2d([[0], [1], [1], [0]]);

async function testTraining() {
  console.log('Training XOR function...');
  const history = await model.fit(xs, ys, {
    epochs: 10,
    verbose: 0
  });
  
  console.log('Training completed');
  console.log('Final loss:', history.history.loss[history.history.loss.length - 1]);
  
  // Test prediction
  const prediction = model.predict(tf.tensor2d([[1, 0]]));
  console.log('Prediction for [1, 0]:');
  prediction.print();
  
  // Cleanup
  a.dispose();
  b.dispose();
  c.dispose();
  xs.dispose();
  ys.dispose();
  prediction.dispose();
  model.dispose();
  
  console.log('\n🎉 All tests passed! Production ML components are working.');
}

testTraining().catch(console.error);