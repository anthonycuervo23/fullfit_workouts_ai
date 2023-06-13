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

// Función para generar el prompt personalizado
async function createPrompt(user) {
  const muscleGroups = ["chest", "shoulders", "back", "lower back", "biceps", "triceps", "hamstrings", "quadriceps", "abs", "glutes", "calves", "forearms", "trapezius", "neck", "abductors", "adductors"];
  let muscleGroupPrompt = "";
  // Obtiene la fecha del día anterior
  let yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday = `${yesterday.getFullYear()}.${yesterday.getMonth() + 1}.${yesterday.getDate()}`;

  // Obtiene el documento del entrenamiento del día anterior
  const db = admin.firestore();
  const userWorkoutRef = db.collection("userWorkouts").doc(`${user.id}-${yesterday}-workout`);
  const lastWorkoutDoc = await userWorkoutRef.get();
  let lastMuscleGroups = [];

  if (lastWorkoutDoc.exists) {
    lastMuscleGroups = lastWorkoutDoc.data().muscle_groups;
  }

  if (lastMuscleGroups.length > 0) {
    muscleGroupPrompt = `Please make sure to target four different muscles, and the workout should not include the following muscle groups: ${lastMuscleGroups.join(", ")} that I have already trained yesterday.`;
  } else {
    muscleGroupPrompt = "Please make sure to target four different muscles.";
  }

  const prompt = `
    Hello, FitGPT. I am a ${user.gender} in the age range of ${user.age_range}, with a height of ${user.height} cm and a weight of ${user.weight} kg and my fitness level is ${user.fitness_level}.
    My fitness goals are to ${user.fitness_goal.join(", ")} and I usually train at the ${user.training_spot}. 
    I need a detailed new workout routine of 90 minutes for today. ${muscleGroupPrompt}
    Please include a suggested warm up, exercises, reps, sets and a cool down.
  
    Please provide the workout as a HTML content with heading, subheading, bullet points, and bold. 
    Also, provide the muscle groups that will be trained in this workout, make sure to use the following muscle groups: ${muscleGroups.join(", ")}.
  
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
      max_tokens: 1600,
    });

    if (!response || !response.data.choices || response.data.choices.length === 0) {
      console.error("Invalid response from OpenAI:", response);
      return;
    }

    const rawMessage = response.data.choices[0].message.content;
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

for (let i = 0; i < 10; i++) {
  exports[`populateWorkoutQueueBlock${i}`] = functions.pubsub.schedule(`${i * 3} 0 * * *`).onRun(async (context) => {
    await populateWorkoutQueueForTimeBlock(i);
  });
}

// Function to populate workout queue
async function populateWorkoutQueueForTimeBlock(timeBlock) {
  try {
    const db = admin.firestore();
    const usersRef = db.collection("users").where("timeBlock", "==", timeBlock);
    const queueRef = db.collection("workoutsQueue");

    const snapshot = await usersRef.get();
    snapshot.forEach(async (doc) => {
      const user = doc.data();
      const date = new Date();
      const conversation_key = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}-workout`;

      const prompt = await createPrompt(user);

      await queueRef.add({
        user_id: doc.id,
        prompt: prompt,
        conversation_key: conversation_key,
      });
    });
  } catch (error) {
    console.error("Failed to populate workout queue:", error);
  }
}

// Function to process workout queue
exports.processWorkoutQueue = functions.firestore.document("workoutsQueue/{taskId}").onCreate(async (snap, context) => {
  try {
    const db = admin.firestore();
    const task = snap.data();

    const userWorkoutsRef = db.collection("userWorkouts").doc(`${task.user_id}-${task.conversation_key}`);
    const doc = await userWorkoutsRef.get();

    if (!doc.exists) {
      const {workout, muscleGroups} = await generateWorkout(task.prompt, task.user_id);
      await userWorkoutsRef.set({
        workout: workout,
        muscle_groups: muscleGroups,
        user_id: task.user_id,
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
    const timeBlock = numUsers % 10;

    const newUserRef = snap.ref;
    await newUserRef.update({timeBlock: timeBlock});
  } catch (error) {
    console.error("Failed to assign time block:", error);
  }
});

// Function to generate workout on registration
exports.generateWorkoutOnRegistration = functions.firestore.document("users/{userId}").onCreate(async (snap, context) => {
  try {
    const db = admin.firestore();
    const userId = context.params.userId;
    const user = snap.data();

    const date = new Date();
    const conversation_key = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}-workout`;
    const userWorkoutsRef = db.collection("userWorkouts").doc(`${userId}-${conversation_key}`);

    const prompt = await createPrompt(user);

    const workoutData = await generateWorkout(prompt, userId);

    await userWorkoutsRef.set({
      workout: workoutData.workout,
      muscle_groups: workoutData.muscleGroups,
      date: date,
      user_id: userId,
    });

    console.log("Workout generated on registration:", workoutData);
  } catch (error) {
    console.error("Failed to generate workout on registration:", error);
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
      const conversation_key = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}-workout`;
      const userWorkoutsRef = db.collection("userWorkouts").doc(`${userId}-${conversation_key}`);
      const doc = await userWorkoutsRef.get();

      if (!doc.exists) {
        const prompt = await createPrompt(user);

        const workoutData = await generateWorkout(prompt, userId);

        await userWorkoutsRef.set({
          workout: workoutData.workout,
          muscle_groups: workoutData.muscleGroups,
          date: date,
          user_id: userId,
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
