const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
    await client.connect();
    const usersCollection = client.db('edumanage').collection('users');
    const teacherRequestCollection = client.db('edumanage').collection('teacherRequests');
    const classesCollection = client.db('edumanage').collection('classes');
    const feedbackCollection = client.db('edumanage').collection('feedback');
    const paymentCollection = client.db('edumanage').collection('payment');

    // Save or update user data
    app.put('/user', async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };

      if (!user) {
        return res.status(400).json({ message: 'User data is required' });
      }

      const isExist = await usersCollection.findOne(query);
      if (isExist) {
        if (user.status === 'Requested') {
          const result = await usersCollection.updateOne(query, {
            $set: { status: user.status },
          });
          return res.send(result);
        } else {
          return res.send(isExist);
        }
      }

      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // Get user info by email
    app.get('/user/:email', async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      if (!result) {
        return res.status(404).json({ message: 'User not found' });
      }
      res.send(result);
    });

    // Fetch users with search functionality
    app.get('/users', async (req, res) => {
      const search = req.query.search || '';
      const query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ]
      };
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });

    // Make a user an admin
    app.patch('/users/make-admin/:id', async (req, res) => {
      const userId = req.params.id;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { role: 'admin' } }
      );
      res.send(result);
    });

    // Save a teacher request
    app.post('/teacher/request', async (req, res) => {
      const requestData = req.body;
      requestData.status = 'pending';
      const result = await teacherRequestCollection.insertOne(requestData);
      res.send(result);
    });

    // Get teacher requests by email
    app.get('/teacher/requests/:email', async (req, res) => {
      const email = req.params.email;
      const result = await teacherRequestCollection.findOne({ email });
      res.send(result);
    });

    // Fetch all teacher requests
    app.get('/teacher/requests', async (req, res) => {
      try {
        const requests = await teacherRequestCollection.find().toArray();
        res.send(requests);
      } catch (error) {
        console.error('Error fetching teacher requests:', error);
        res.status(500).json({ message: 'Failed to fetch teacher requests' });
      }
    });

    // Approve a teacher request and update user role to 'teacher'
    app.patch('/teacher/request/approve/:id', async (req, res) => {
      const requestId = req.params.id;
      try {
        const result = await teacherRequestCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { status: 'accepted' } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: 'Teacher request not found' });
        }

        const teacherRequest = await teacherRequestCollection.findOne({ _id: new ObjectId(requestId) });
        if (!teacherRequest) {
          return res.status(404).json({ message: 'Teacher request not found' });
        }

        const userEmail = teacherRequest.email;

        const user = await usersCollection.findOne({ email: userEmail });
        if (!user) {
          return res.status(404).json({ message: 'User not found' });
        }

        const userId = user._id;

        const userResult = await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { role: 'teacher' } }
        );

        if (userResult.matchedCount === 0) {
          return res.status(404).json({ message: 'User not found or role not updated' });
        }

        res.json({ message: 'Teacher request approved successfully' });
      } catch (error) {
        console.error('Error approving teacher request:', error);
        res.status(500).json({ message: 'Failed to approve teacher request' });
      }
    });

    // Reject a teacher request
    app.patch('/teacher/request/reject/:id', async (req, res) => {
      const requestId = req.params.id;
      const result = await teacherRequestCollection.updateOne(
        { _id: new ObjectId(requestId) },
        { $set: { status: 'rejected' } }
      );
      res.send(result);
    });

    // Add Classes
    app.post('/addclasses', async (req, res) => {
      const classData = req.body;
      classData.totalEnrollment = 0;
      classData.students = [];
      const result = await classesCollection.insertOne(classData);
      res.send(result);
    });

    // Get all classes by admin
    app.get('/classes', async (req, res) => {
      const result = await classesCollection.find().toArray();
      res.send(result);
    });
// POST route to create an assignment for a specific class
app.post('/class/assignment/:id', async (req, res) => {
  const classId = req.params.id;
  const { title, description, deadline } = req.body;
    // Insert the assignment into the database
    const result = await classesCollection.updateOne(
      { _id: new ObjectId(classId) },
      {
        $push: {
          assignments: {
            _id: new ObjectId(),
            title,
            description,
            deadline,
            submissionCount: 0,
          },
        },
        $inc: { totalAssignments: 1 },
      }
    );
    // Retrieve updated class details after assignment creation
    const updatedClass = await classesCollection.findOne({ _id: new ObjectId(classId) });
    // Return the updated class details with assignments
    res.send(updatedClass)
});

// PATCH route to submit an assignment and increment submission count
app.patch('/class/:classId/assignment/:assignmentId/submit', async (req, res) => {
  const { classId, assignmentId } = req.params;
    // Update the assignment submission count for the specific assignment
    const result = await classesCollection.updateOne(
      { _id: new ObjectId(classId), 'assignments._id': new ObjectId(assignmentId) },
      { $inc: { 'assignments.$.submissionCount': 1 } }
    );
    res.send(result)
});


    // Get approved classes (status: 'approved')
    app.get('/classes/approved', async (req, res) => {
      const result = await classesCollection.find({ status: 'approved' }).toArray();
      res.send(result);
    });
    // Get classes by teacher email
    app.get('/classes/teacher/:email', async (req, res) => {
      const email = req.params.email;
      const result = await classesCollection.find({ 'teacher.email': email }).toArray();
      res.send(result);
    });

    // Delete a class by ID
    app.delete('/class/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await classesCollection.deleteOne(query);
      res.send(result);
    });

    // Route to update a class by ID
    app.put('/class/update/:id', async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: updateData,
      };

      const result = await classesCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // Approve a class
    app.patch('/class/approve/:id', async (req, res) => {
      const id = req.params.id;
      const result = await classesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'approved' } }
      );
      res.send(result);
    });

    // Reject a class
    app.patch('/class/reject/:id', async (req, res) => {
      const id = req.params.id;
      const result = await classesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'rejected' } }
      );
      res.send(result);
    });

    // Get a class by id
    app.get('/class/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await classesCollection.findOne(query);
      res.send(result);
    });

    //get populer class
    app.get('/popular-classes', async (req, res) => {
        const classes = await classesCollection.find({ status: 'approved' }).sort({ totalEnrollment: -1 }).limit(6).toArray();
        res.send(classes);
     
    });
    
    

    // Payment intent
    app.post('/create-payment-intent', async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount, 'amount inside the intent')

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card'],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

  // Handle payments and update class enrollment and student email
  app.post('/payments', async (req, res) => {
    const payment = req.body;
    
    // Extract classId from enrolldClassDetails
    const { enrolldClassDetails } = payment;
    if (!enrolldClassDetails || !enrolldClassDetails._id) {
      return res.status(400).json({ message: 'Invalid enrolldClassDetails' });
    }
    const classId = enrolldClassDetails._id;
  
    try {
      // Validate the class ID exists
      const classExists = await classesCollection.findOne({ _id: new ObjectId(classId) });
      if (!classExists) {
        return res.status(404).json({ message: 'Class not found' });
      }
  
      // Insert payment into payment collection
      const paymentResult = await paymentCollection.insertOne(payment);
  
      // Update class enrollment and add student email to the class
      const { email } = payment;
      const classResult = await classesCollection.updateOne(
        { _id: new ObjectId(classId) },
        {
          $inc: { totalEnrollment: 1 },
          $addToSet: { students: email } // Add student email to the class
        }
      );
  
      res.send(paymentResult);
    } catch (error) {
      console.error('Error handling payment and updating class:', error);
      res.status(500).json({ message: 'Failed to process payment and update class' });
    }
  });

app.get('/payments', async(req, res) => {
  const result = await paymentCollection.find().toArray();
  res.send(result)
})

  //get my enroll ment class
  app.get('/my-enroll-class/:email', async(req, res) => {
    const email = req.params.email;
      const result = await paymentCollection.find({ email: email }).toArray();
      res.send(result)
  })

  // POST route to save Teaching Evaluation Report (TER)
  app.post('/teaching-evaluation-report', async (req, res) => {
    const { description, ratings, name, image, title, classId } = req.body;
      // Insert into feedback collection
      const result = await feedbackCollection.insertOne({
        description,
        ratings,
        name,
        image,
        title,
        createdAt: new Date(),
      });
      // Update classesCollection with ratings
      const updateResult = await classesCollection.updateOne(
        { _id: new ObjectId(classId) },
        { $set: { ratings } }
      );
res.send(result)
  });

    // GET route to fetch Teaching Evaluation Reports
    app.get('/teaching-evaluation-reports', async (req, res) => {
        const reports = await feedbackCollection.find().toArray();
        res.send(reports);
    });
  


    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Do not close the client as it will close the connection
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('server is running')
})

app.listen(port, () => {
  console.log(`EduManage server running on port ${port}`);
});
