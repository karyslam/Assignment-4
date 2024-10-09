var express = require("express");
const cors = require("cors");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
const { ObjectId } = require("mongodb");
const MongoClient = require("mongodb").MongoClient;
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

require("dotenv").config();

const dbname = "assignment4-products";

var app = express();

app.use(cors()); // enable cross origin resources sharing
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// set the mongoUri to be MONGO_URI from the .env file
// make sure to read data from process.env AFTER `require('dotenv').config()`
const mongoUri = process.env.MONGO_URI;

// function to generate an access token
function generateAccessToken(id, email) {
  // set the payload of the JWT (i.e, developers can add any data they want)
  let payload = {
    user_id: id,
    email: email,
  };

  // create the JWT
  // jwt.sign()
  // - parameter 1: the payload (sometimes known as 'claims')
  // - parameter 2: token secret,
  // - parameter 3: options (to set expiresIn)
  let token = jwt.sign(payload, process.env.TOKEN_SECRET, {
    expiresIn: "1h", // h for hour, d for days, m is for minutes and s is for seconds
  });

  return token;
}

// middleware: a function that executes before a route function
function verifyToken(req, res, next) {
  // get the JWT from the headers
  let authHeader = req.headers["authorization"];
  let token = null;
  if (authHeader) {
    // the token will be stored as in the header as:
    // BEARER <JWT TOKEN>
    token = authHeader.split(" ")[1];
    if (token) {
      // the callback function in the third parameter will be called after
      // the token has been verified
      jwt.verify(token, process.env.TOKEN_SECRET, function (err, payload) {
        if (err) {
          console.error(err);
          return res.sendStatus(403);
        }
        // save the payload into the request
        req.user = payload;
        // call the next middleware or the route function
        next();
      });
    } else {
      return res.sendStatus(403);
    }
  } else {
    return res.sendStatus(403);
  }
}

// uri = connection string
async function connect(uri, dbname) {
  // Create a Mongo Client
  // a client is a software or driver that allows us to communicate with a database
  // (i.e like the Mongo Shell)
  let client = await MongoClient.connect(uri, {
    useUnifiedTopology: true,
  });
  let db = client.db(dbname); // same as  'USE <database>' in Mongo Shell
  return db;
}

// 2. CREATE ROUTES
// All routes will be created in the `main` function
async function main() {
  // connect to the mongo database
  let db = await connect(mongoUri, dbname);

  app.get("/", function (req, res) {
    res.json({
      message: "Welcome to the online supermarket!",
    });
  });

  // There's a convention for RESTFul API when it comes to writing the URL
  // The URL should function like a file path  (always a resource, a noun)
  // Allow the user to search by name, tags, category, ingredients:
  // eg
  // ?name=chicken rice
  // ?tags=appetizer&ingredients=chicken,duck
  app.get("/products", verifyToken, async function (req, res) {
    try {
      // this is the same as let tags = req.query.tags etc. etc.
      // syntax: object destructuring
      let { tags, category, name, brand } = req.query;

      let criteria = {};

      if (tags) {
        criteria["tags.name"] = {
          $in: tags.split(","),
        };
      }

      if (category) {
        criteria["category.name"] = {
          $regex: category,
          $options: "i",
        };
      }

      if (brand) {
        criteria["brand.name"] = {
          $regex: brand,
          $options: "i",
        };
      }

      if (name) {
        criteria["name"] = {
          $regex: name,
          $options: "i",
        };
      }

      // mongo shell: db.products.find({},{name:1, category:1, tags:1, price:1})
      let products = await db
        .collection("products")
        .find(criteria)
        .project({
          name: 1,
          category: 1,
          tags: 1,
          brand: 1,
        })
        .toArray();
      res.json({
        products: products,
      });
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500);
    }
  });

  // /products/12345A => get the details of the product with _id 12345A
  app.get("/products/:id", async function (req, res) {
    try {
      let id = req.params.id;
      let product = await db.collection("products").findOne({
        _id: new ObjectId(id),
      });

      if (!product) {
        return res.status(404).json({
          error: "Sorry, product not found",
        });
      }

      // send back a response
      res.json(product);
    } catch (error) {
      console.error("Error fetching product:", error);
      res.status(500);
    }
  });

  // we use app.post for HTTP METHOD POST - usually to add new data
  app.post("/products", async function (req, res) {
    try {
      // name, category, price, description  and tags
      // when we use POST, PATCH or PUT to send data to the server, the data are in req.body
      let { name, category, brand, price, description, tags } = req.body;

      // basic validation: make sure that name, category,  instructions and tags
      if (!name || !category || !brand || !price || !description || !tags) {
        return res.status(400).json({
          error: "Missing fields required",
        });
      }

      // find the _id of the related brands and add it to the new product
      let brandDoc = await db.collection("brands").findOne({
        name: brand,
      });

      if (!brandDoc) {
        return res.status(400).json({ error: "Invalid brand" });
      }

      // find the _id of the related category and add it to the new product
      let categoryDoc = await db.collection("categories").findOne({
        name: category,
      });

      if (!categoryDoc) {
        return res.status(400).json({ error: "Invalid category" });
      }

      // find all the tags that the client want to attach to the product document
      const tagDocuments = await db
        .collection("tags")
        .find({
          name: {
            $in: tags,
          },
        })
        .toArray();

      let newProduct = {
        name,
        category_id: categoryDoc._id,
        brand_id: brandDoc._id,
        price,
        description,
        tags: tagDocuments,
      };

      // insert the new product document into the collection
      let result = await db.collection("products").insertOne(newProduct);
      res.status(201).json({
        message: "New product has been created",
        productId: result.insertedId, // insertedId is the _id of the new document
      });
    } catch (e) {
      console.error(e);
      res.status(500);
    }
  });

  app.put("/products/:id", async function (req, res) {
    try {
      let id = req.params.id;

      // name, category, price, description,   instructions and tags
      // when we use POST, PATCH or PUT to send data to the server, the data are in req.body
      let { name, category, brand, price, description, tags } = req.body;

      // basic validation: make sure that name, category,  instructions and tags
      if (!name || !category || !brand || !price || !description || !tags) {
        return res.status(400).json({
          error: "Missing fields required",
        });
      }

      // find the _id of the related brands and add it to the new product
      let brandDoc = await db.collection("brands").findOne({
        name: brand,
      });

      if (!brandDoc) {
        return res.status(400).json({ error: "Invalid brand" });
      }

      // find the _id of the related category and add it to the new product
      let categoryDoc = await db.collection("categories").findOne({
        name: category,
      });

      if (!categoryDoc) {
        return res.status(400).json({ error: "Invalid category" });
      }

      // find all the tags that the client want to attach to the product document
      const tagDocuments = await db
        .collection("tags")
        .find({
          name: {
            $in: tags,
          },
        })
        .toArray();

      let updatedProduct = {
        name,
        category_id: categoryDoc._id,
        brand_id: brandDoc._id,
        price,
        description,
        tags: tagDocuments,
      };

      // insert the new product document into the collection
      let result = await db.collection("products").updateOne(
        {
          _id: new ObjectId(id),
        },
        {
          $set: updatedProduct,
        }
      );

      // if there is no matches, means no update took place
      if (result.matchedCount == 0) {
        return res.status(404).json({
          error: "product not found",
        });
      }

      res.status(200).json({
        message: "product updated",
      });
    } catch (e) {
      console.error(e);
      res.status(500);
    }
  });

  app.delete("/products/:id", async function (req, res) {
    try {
      let id = req.params.id;

      let results = await db.collection("products").deleteOne({
        _id: new ObjectId(id),
      });

      if (results.deletedCount == 0) {
        return res.status(404).json({
          error: "product not found",
        });
      }

      res.json({
        message: "product has been deleted successful",
      });
    } catch (e) {
      console.error(e);
      res.status(500);
    }
  });

  // route for user to sign up
  // the user must provide an email and password
  app.post("/users", async function (req, res) {
    try {
      let { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({
          error: "Please provide email and password",
        });
      }

      // if the request has both email and password
      let userDocument = {
        email,
        password: await bcrypt.hash(password, 12),
      };

      let result = await db.collection("users").insertOne(userDocument);

      res.json({
        message: "New user account has been created",
        result,
      });
    } catch (e) {
      console.error(e);
      res.status(500);
    }
  });

  // the client is supposed to provide the email and password in req.body
  app.post("/login", async function (req, res) {
    console.log("A1")
    try {
      let { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({
          message: "Please provide email and password",
        });
      }

      // find the user by their email
      let user = await db.collection("users").findOne({
        email: email,
      });
      console.log("B1")
      console.log(user)

      // if the user exists
      if (user) {
        console.log("A")
        // check the password (compare plaintext with the hashed one in the database)
        if (bcrypt.compareSync(password, user.password)) {
          console.log("B")
          let accessToken = generateAccessToken(user._id, user.email);
          console.log("C")
          res.json({
            accessToken: accessToken,
          });
          return
        } else {
          res.status(401);
          return
        }
      } else {
        res.status(401);
        return
      }
    } catch (e) {
      console.error(e);
      res.status(500);
      return
    }
  });
}
main();

module.exports = app;
