const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const app = express();
const firebase = require('firebase');
const BusBoy = require('busboy');
const path = require('path');
const os = require('os');
const fs = require('fs');
require('dotenv').config();

const firebaseConfig = {
    apiKey: process.env.APIKEY,
    authDomain: process.env.AUTHDOMAIN,
    databaseURL: process.env.DATABASEURL,
    projectId: process.env.PROJECTID,
    storageBucket: process.env.STORAGEBUCKET,
    messagingSenderId: process.env.MESSAGINGSENDERID,
    appId: process.env.APPID,
    measurementId: process.env.MEASUREMENTID
};
admin.initializeApp();

firebase.initializeApp(firebaseConfig);


const FirebaseAuth = (req, res, next) => {
    let idToken;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        idToken = req.headers.authorization.split('Bearer ')[1];
    } else {
        console.error('No token found');
        return res.status(403).json({ error: 'Unauthorized ' });
    }

    admin.auth().verifyIdToken(idToken)
        .then(decodedToken => {
            req.user = decodedToken;
            return admin.firestore().collection('users')
                .where('userId', '==', req.user.uid)
                .limit(1)
                .get();
        })
        .then(data => {
            req.user.handle = data.docs[0].data().handle;
            req.user.imageUrl = data.docs[0].data().imageUrl;
            return next()
        })
        .catch(err => {
            console.error('Error while verifying user token', err)
            return res.status(403).json(err);
        })
}

const isEmail = (email) => {
    const regEx = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    if (email.match(regEx)) return true;
    else return false;
}

const isEmpty = (string) => {
    if (string == null) return true;
    else return false;
}

const reduceUserDetails = (data) => {
    let userDetails = {};

    if (!isEmpty(data.bio)) userDetails.bio = data.bio;
    if (!isEmpty(data.website)) userDetails.website = data.website;
    if (!isEmpty(data.location)) userDetails.location = data.location;

    return userDetails;
}

app.get('/tweets', (req, res) => {
    admin.firestore()
        .collection('tweets')
        .orderBy('createdAt', 'desc')
        .get()
        .then((data) => {
            let tweets = [];
            data.forEach((doc) => {
                tweets.push({
                    tweetId: doc.id,
                    body: doc.data().body,
                    userHandle: doc.data().userHandle,
                    createdAt: doc.data().createdAt,
                    commentCount: doc.data().commentCount,
                    likeCount: doc.data().likeCount,
                    userImage: doc.data().userImage
                });
            });
            return res.json(tweets);
        })
        .catch(err => console.error(err));
})

app.post('/tweet', FirebaseAuth, (req, res) => {
    const newTweet = {
        body: req.body.body,
        userHandle: req.user.handle,
        createdAt: new Date().toISOString(),
        userImage: req.user.imageUrl,
        likeCount: 0,
        commentCount: 0
    };

    admin.firestore()
        .collection('tweets')
        .add(newTweet)
        .then(doc => {
            const resTweet = newTweet;
            resTweet.tweetId = doc.id;
            return res.json(resTweet);
            // res.json({ message: `document ${doc.id} created successfully` });
        })
        .catch(err => {
            res.status(500).json({ error: `something went wrong: ${err}` });
            console.error(err);
        })
});
//sign-up route
app.post('/signup', (req, res) => {
    const newUser = {
        email: req.body.email,
        password: req.body.password,
        confirmPassword: req.body.confirmPassword,
        userHandle: req.body.userHandle
    }
    let errors = {};

    if (isEmpty(newUser.email)) {
        errors.email = 'Email address cannot be empty'
    } else if (!isEmail(newUser.email)) {
        errors.email = 'Please enter a valid email address'
    }
    if (isEmpty(newUser.password)) errors.password = 'Password cannot be empty';
    if (isEmpty(newUser.confirmPassword)) errors.confirmPassword = 'Re-enter your password';
    if (newUser.password !== newUser.confirmPassword) errors.confirmPassword = 'Passwords must match';
    if (isEmpty(newUser.userHandle)) errors.userHandle = 'Handle cannot be empty';
    if (Object.keys(errors).length > 0) return res.status(400).json(errors)

    const noImage = 'blank-image.png'
    let token, userId;
    // validate user
    admin.firestore()
        .doc(`/users/${newUser.userHandle}`).get()
        .then(doc => {
            if (doc.exists) {
                return res.status(400).json({ userHandle: 'this handle is already taken' });
            }
            else {
                return firebase.auth().createUserWithEmailAndPassword(newUser.email, newUser.password)
            }
        }).then(data => {
            userId = data.user.uid;
            return data.user.getIdToken()
        })
        .then(tokenId => {
            token = tokenId;
            const userCredentials = {
                handle: newUser.userHandle,
                email: newUser.email,
                password: newUser.password,
                createdAt: new Date().toISOString(),
                imageUrl: `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${noImage}?alt=media`,
                userId: userId
            };
            return admin.firestore().doc(`/users/${newUser.userHandle}`).set(userCredentials);
        })
        .then(() => {
            return res.status(201).json({ token })
        })
        .catch((err) => {
            console.error(err);
            if (err.code === 'auth/email-already-in-use') {
                return res.status(400).json({ email: 'Email  already in use' });
            } else {
                return res.status(500).json({ error: err.code });
            }
        });
});

app.post('/login', (req, res) => {
    const user = {
        email: req.body.email,
        password: req.body.password
    };
    let errors = {};
    if (isEmpty(user.email)) errors.email = 'Email cannot be empty';
    if (isEmpty(user.password)) errors.password = 'Enter your password';
    if (Object.keys(errors).length > 0) return res.status(400).json(errors);

    firebase.auth().signInWithEmailAndPassword(user.email, user.password)
        .then(data => {
            return data.user.getIdToken();
        })
        .then(token => {
            return res.json({ token });
        })
        .catch(err => {
            console.error(err);
            if (err.code === 'auth/wrong-password') {
                return res.status(400).json({ general: 'Incorrect password' });
            } else if (err.code === 'auth/invalid-email') {
                return res.status(400).json({ email: 'Please enter a valid email address' });
            } else if (err.code === 'auth/user-not-found') {
                return res.status(400).json({ email: 'User does not exist' });
            } else
                return res.status(400).json({ error: err.code });
        });
});

app.post('/user/image', FirebaseAuth, (req, res) => {
    const busboy = new BusBoy({ headers: req.headers });
    let imageFileName;
    let imageToBeUploaded = {};

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
        if (mimetype !== 'image/png' && mimetype !== 'image/jpeg') {
            return res.status(400).json({ error: 'You can only upload jpeg and png images' });
        }

        const imgExtension = filename.split('.')[filename.split('.').length - 1];
        imageFileName = `${Math.round(Math.random() * 100000000000)}.${imgExtension}`
        const filepath = path.join(os.tmpdir(), imageFileName);
        imageToBeUploaded = { filepath, mimetype };
        file.pipe(fs.createWriteStream(filepath));
    });
    busboy.on('finish', () => {
        admin.storage().bucket().upload(imageToBeUploaded.filepath, {
            resumable: false,
            metadata: {
                metadata: {
                    contentType: imageToBeUploaded.mimetype
                }
            }
        })
            .then(() => {
                const imageUrl = `https://firebasestorage.googleapis.com/v0/b/twitterer-app-clone.appspot.com/o/${imageFileName}?alt=media`;
                return admin.firestore().doc(`/users/${req.user.handle}`).update({ imageUrl: imageUrl });
            })
            .then(() => {
                return res.json({ message: 'image uploaded successfully' })
            })
            .catch(err => {
                console.error(err);
                return res.status(500).json({ error: err.code })
            });
    });
    busboy.end(req.rawBody);
});
//update user details
app.post('/user', FirebaseAuth, reduceUserDetails, (req, res) => {
    const updateUser = {
        bio: req.body.bio,
        website: req.body.website,
        location: req.body.location
    };

    let userDetails = reduceUserDetails(updateUser);
    admin.firestore().doc(`/users/${req.user.userHandle}`).update(userDetails)
        .then(() => {
            return res.json({ message: 'details updated successfully' });
        })
        .catch(err => {
            console.error(err);
            res.status(500).json({ error: err.code });
        })
});

app.get('/user', FirebaseAuth, (req, res) => {
    let userData = {};
    admin.firestore().doc(`/users/${req.user.handle}`).get()
        .then((doc) => {
            if (doc.exists) {
                userData.credentials = doc.data();
                return admin.firestore().collection('likes').where('userHandle', '==', req.user.handle).get()
            }
        })
        .then(data => {
            userData.likes = [];
            data.forEach(doc => {
                userData.likes.push(doc.data());
            });
            return res.json(userData);
        })
        .catch(err => {
            console.error(err);
            return res.status(500).json({ error: err.code });
        });

});

app.get('/tweet/:tweetId', (req, res) => {
    let tweetData = {
        comments: []
    };
    admin.firestore().doc(`/tweets/${req.params.tweetId}`)
        .get()
        .then((doc) => {
            if (!doc.exists) {
                return res.status(404).json({ error: 'tweet not found' });
            }
            tweetData = doc.data();
            tweetData.tweetId = doc.id;
            return admin.firestore()
                .collection('comments')
                .orderBy('createdAt', 'desc')
                .where('tweetId', '==', req.params.tweetId)
                .get();
        })
        .then((data) => {
            tweetData.comments = [];
            data.forEach((doc) => {
                tweetData.comments.push(doc.data());
            });
            return res.json(tweetData);
        })
        .catch((err) => {
            console.error(err);
            return res.status(500).json({ error: err.code });
        });

});

app.post('/tweet/:tweetId/comment', FirebaseAuth, (req, res) => {
    if (isEmpty(req.body.body)) return res.status(400).json({ error: 'pls input your comment' });

    const newComment = {
        body: req.body.body,
        createdAt: new Date().toISOString(),
        tweetId: req.params.tweetId,
        userHandle: req.user.handle,
        userImage: req.user.imageUrl
    }
    admin.firestore().doc('/tweets/${req.params.tweetId}')
        .get()
        .then(doc => {
            // if (!doc.exists) {
            //     return res.status(400).json({ error: 'Tweet does not exist anymore' });
            // }
            return admin.firestore().collection('comments').add(newComment);
        })
        .then(() => {
            return res.json(newComment)
        })
        .catch(err => {
            res.status(500).json({ error: err.code });
        });

});

app.get('/tweet/:tweetId/like', FirebaseAuth, (req, res) => {
    const likeDocument = admin.firestore().collection('likes').where('userHandle', '==', req.user.handle)
        .where('tweetId', '==', req.params.tweetId).limit(1);

    const tweetDocument = admin.firestore().doc('/tweets/${req.params.tweetId}');
    let tweetData;

    tweetDocument.get()
        .then(doc => {
            if (doc.exists) {
                tweetData = doc.data()
                tweetData.tweetId = doc.id;
                return likeDocument.get();
            } else {
                return res.status(404).json({ error: 'tweet not found' });
            }
        }).then(data => {
            if (data.empty) {
                return admin.firestore().collection('likes').add({
                    tweetId: req.params.tweetId,
                    userHandle: req.user.handle
                })
                    .then(() => {
                        tweetData.likeCount++
                        return tweetDocument.update({ likeCount: tweetData.likeCount });
                    })
                    .then(() => {
                        return res.json(tweetData);
                    });
            } else {
                return res.status(400).json({ error: 'You can only like once' });
            }
        })
        .catch(err => {
            console.error(err);
            res.status(400).json({ error: err.code });
        })
});

app.get('/tweet/:tweetId/unlike', FirebaseAuth, (req, res) => {

})

exports.api = functions.https.onRequest(app); 