const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const usersCollection = client.db('edumanage').collection('users')
    const classCollection = client.db('edumanage').collection('class')


 // save a user data in db
 app.put('/user', async (req, res) => {
  const user = req.body
  const query = { email: user?.email }
  // check if user already exists in db
  const isExist = await usersCollection.findOne(query)
  if (isExist) {
    if (user.status === 'Requested') {
      // if existing user try to change his role
      const result = await usersCollection.updateOne(query, {
        $set: { status: user?.status },
      })
      return res.send(result)
    } else {
      // if existing user login again
      return res.send(isExist)
    }
  }

  // save user for the first time
  const options = { upsert: true }
  const updateDoc = {
    $set: {
      ...user,
      timestamp: Date.now(),
    },
  }
  const result = await usersCollection.updateOne(query, updateDoc, options)
  res.send(result)
})

 // get a user info by email from db
    app.get('/user/:email', async (req, res) => {
      const email = req.params.email
      const result = await usersCollection.findOne({ email })
      res.send(result)
    })


    // get all users data from db
    app.get('/users', async (req, res) => {
      const result = await usersCollection.find().toArray()
      res.send(result)
    })

 //update a user role
 app.patch('/users/update/:email', async (req, res) => {
  const email = req.params.email
  const user = req.body
  const query = { email }
  const updateDoc = {
    $set: { ...user, timestamp: Date.now() },
  }
  const result = await usersCollection.updateOne(query, updateDoc)
  res.send(result)
})

 // Save a class data in db
 app.post('/add-class', async (req, res) => {
  const classData = req.body
  const result = await classCollection.insertOne(classData)
  res.send(result)
})

 // Get all classes for a specific teacher
    app.get('/classes', async (req, res) => {
      const email = req.query.email;
      const result = await classCollection.find({ 'teacher.email': email }).toArray();
      res.send(result);
    });
 // Delete a class by ID
 app.delete('/class/:id', async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await classCollection.deleteOne(query);
  res.send(result);
});

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('server is Ranning')
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
