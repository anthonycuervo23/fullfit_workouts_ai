// Firebase Cloud Functions and Firestore initialization
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const apiKey = functions.config().openai.key;

// OpenAI initialization
const {Configuration, OpenAIApi} = require("openai");
const configuration = new Configuration({
  apiKey: apiKey,
});
const openai = new OpenAIApi(configuration);

//TODO: modificar prompt cuando la lista de lastMucleGurops sea vacía
// Función para generar el prompt personalizado
async function createPrompt(user, lastMuscleGroups) {
  const prompt = `
    Hello, FitGPT. I am a ${user.gender} in the age range of ${user.age_range}, with a height of ${user.height} cm and a weight of ${user.weight} kg and my fitness level is ${user.fitness_level}.
    My fitness goals are to ${user.fitness_goal.join(", ")} and I usually train at the ${user.training_spot}. 
    I need a new workout routine for today. Please make sure to target two different muscles and the workout does not include the following muscle groups: ${lastMuscleGroups.join(", ")} that I have already trained yesterday.
    please include a warm up and a cool down in the workout.
  
    Please provide the workout as a HTML content with heading, subheading, bullet points, and bold. 
    Also, provide the muscle groups that will be trained in this workout.
  
    The output should be in JSON format like this:
    {
      "muscleGroups": ["group1", "group2", ...],
      "workout": "<html><body><h1>Workout Title</h1> ..."
    }
    `;
  return prompt;
}


// Function to generate workout
async function generateWorkout(prompt, userId) {
  console.log("Prompt:", prompt);
  console.log("my api key: ", apiKey);
  try {
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are FitGPT, a personal trainer AI bot who brings the pain.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      user: userId,
      max_tokens: 800,
    });

    const rawMessage = response.choices[0].message.content;
    const firstIndex = rawMessage.indexOf("{");
    const lastIndex = rawMessage.lastIndexOf("}");

    const jsonString = rawMessage.slice(firstIndex, lastIndex + 1);

    const output = JSON.parse(jsonString);

    return {muscleGroups: output.muscleGroups, workout: output.workout};
  } catch (error) {
    console.error("Failed to generate workout:", error);
    return null;
  }
}

// Function to populate workout queue
exports.populateWorkoutQueue = functions.pubsub.schedule("every day 00:00").onRun(async (context) => {
  try {
    const db = admin.firestore();
    const usersRef = db.collection("users");
    const queueRef = db.collection("workoutsQueue");

    const snapshot = await usersRef.get();
    snapshot.forEach(async (doc) => {
      const user = doc.data();
      const date = new Date();
      const conversation_key = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}-${doc.id}-workout`;

      const prompt = await createPrompt(user, user.lastMuscleGroups || []);

      await queueRef.add({
        user_id: doc.id,
        prompt: prompt,
        conversation_key: conversation_key,
      });
    });
  } catch (error) {
    console.error("Failed to populate workout queue:", error);
  }
});

// Function to process workout queue
exports.processWorkoutQueue = functions.firestore.document("workoutsQueue/{taskId}").onCreate(async (snap, context) => {
  try {
    const db = admin.firestore();
    const task = snap.data();

    const userWorkoutsRef = db.collection("userWorkouts").doc(`${task.user_id}-${task.conversation_key}`);
    const doc = await userWorkoutsRef.get();

    if (!doc.exists) {
      const workout = await generateWorkout(task.prompt, task.user_id);
      await userWorkoutsRef.set({
        workout: workout,
        date: new Date(),
      });
    }

    await snap.ref.delete();
  } catch (error) {
    console.error("Failed to process workout queue:", error);
  }
});

// Function to assign time block
exports.assignTimeBlock = functions.firestore.document("users/{userId}").onCreate(async (snap, context) => {
  try {
    const db = admin.firestore();
    const usersRef = db.collection("users");
    const snapshot = await usersRef.get();
    const numUsers = snapshot.size;
    const timeBlock = numUsers % 100;

    const newUserRef = snap.ref;
    await newUserRef.update({timeBlock: timeBlock});
  } catch (error) {
    console.error("Failed to assign time block:", error);
  }
});

// Function to generate workout on login
exports.generateWorkoutOnLogin = functions.firestore.document("users/{userId}").onUpdate(async (change, context) => {
  const updatedFields = change.after.data();
  const previousFields = change.before.data();

  // Verificar si el campo last_login ha sido actualizado
  if (updatedFields.last_login !== previousFields.last_login) {
    try {
      const db = admin.firestore();
      const userId = context.params.userId;
      const user = updatedFields;

      const date = new Date();
      const conversation_key = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}-${userId}-workout`;
      const userWorkoutsRef = db.collection("userWorkouts").doc(`${userId}-${conversation_key}`);
      const doc = await userWorkoutsRef.get();

      if (!doc.exists) {
        const prompt = await createPrompt(user, user.lastMuscleGroups || []);

        const workoutData = await generateWorkout(prompt, userId);

        await userWorkoutsRef.set({
          workout: workoutData.workout,
          date: date,
          userId: userId,
        });

        // Almacenar los grupos de músculos trabajados en el documento del usuario
        await db.collection("users").doc(userId).update({
          lastMuscleGroups: workoutData.muscleGroups,
        });

        console.log("Workout generated on login:", workoutData);
      } else {
        console.log("Workout already exists for today and user:", doc.data().workout);
      }
    } catch (error) {
      console.error("Failed to generate workout on login:", error);
    }
  }
});


// exports.generateWorkoutOnLogin = functions.https.onRequest(async (req, res) => {
//   try {
//     const userId = req.query.userId;
//     const prompt = req.query.prompt;

//     const db = admin.firestore();
//     const date = new Date();
//     const conversation_key = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}-${userId}-workout`;

//     const userWorkoutsRef = db.collection("userWorkouts").doc(`${userId}-${conversation_key}`);
//     const doc = await userWorkoutsRef.get();

//     if (!doc.exists) {
//       const workout = await generateWorkout(prompt, conversation_key);

//       await userWorkoutsRef.set({
//         workout: workout,
//         date: date,
//       });

//       res.send(workout);
//     } else {
//       res.send(doc.data().workout);
//     }
//   } catch (error) {
//     console.error("Failed to generate workout on login:", error);
//     res.status(500).send("An error occurred while generating the workout.");
//   }
// });
