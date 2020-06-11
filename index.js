const app = require('express')();
const http = require('http').createServer(app);
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server: http })
const PORT = process.env.PORT || 8080;

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

http.listen(PORT, () => {
    console.log('Started serving');
});

app.get('/dbg/' + (process.env.key || '') , (req, res) => {
    res.write(JSON.stringify(store));
    res.send();
});

app.get('/reset/' + (process.env.key || '') , (req, res) => {
    store.length = 0;
    res.write(JSON.stringify(store));
    res.send();
});

app.get('/votes', (req, res) => {
    res.write(JSON.stringify(Store2VoteCount()));
    res.send();
});

// format: 
// [
//     {
//         'question': digestMessage,
//         'answers': [
//             {
//                 answer: digestMessage,
//                 voters: ['attempt 1', 'attempt 2']
//             }
//         ]
//     }
// ]
const store = [];

function ResetQuestionAnswersForAuthor(author, question) {
    const qObj = store.find(g => g.question === question);
    if (!qObj) return;

    qObj.answers.forEach(a => {
        a.voters = a.voters.filter(v => v !== author);
    });
}

// Clears the previous answers from the author on the question
// Sets the answers to the question with author name
function UpdateAnswers(author, question, answers) {
    ResetQuestionAnswersForAuthor(author, question);

    const qObj = store.find(g => g.question === question);
    
    // If this is a new quesiton
    if (!qObj) {
        store.push({
            question,
            answers: answers.map(a => ({
                answer: a,
                voters: [author]
            }))
        });

        // We inserted the question in the store, and added the questtions
        // The author voted for
        return;
    }

    const storedAnswerArray = store
        .find(g => g.question === question)
        .answers;

    // We need to insert / find the answer and add the voter
    for (const answer of answers) {
        const aObj = storedAnswerArray.find(g => g.answer === answer);

        // If this is an unknown answer
        if (!aObj) {
            storedAnswerArray.push({
                answer,
                voters: [author]
            })
        }
        else {
            // This is a known answer
            aObj.voters.push(author);
        }

    }
}

function Store2VoteCount(topics = []) {
    if (topics === []) {
        // WS connected w/o a topics key
        // subscribed to nothing
        return {};
    }

    /**
     * {
     *  "questiondigest": [
     *      "answerdigest1": "numvotes",
     *      "answerdigest2": "numvotes"
     *  ]
     * }
     */

    const dto = {};
    const significant_store = store.filter(e => topics.includes(e.question));
    for (const oq of significant_store) {
        const question = oq.question;

        const answers = oq.answers.map(a => {
            const plain = {};
            plain[a.answer] = '' + a.voters.length;
            return plain;
        });

        dto[question] = answers;
    }

    return dto;
}

function getTopicsFromUrl(url) {
    if (!url.length) {
        return [];
    }

    if (url[0] === '/') {
        url = url.substring(1);
    }

    const parser = new URLSearchParams(url);

    if (!parser.has('topics')) {
        return [];
    }

    return parser.get('topics').split(',');
}

// doc https://github.com/websockets/ws
wss.on('connection', (ws, req) => {

    // Uh oh.. stinky
    ws.topics = getTopicsFromUrl(req.url);
    
    ws.on('message', message => {
        // console.log(`Received message => ${message}`)
        
        try {
            const data = JSON.parse(message);
            const questionDigest = data.question;
            const answerDigests = data.answers;
            const author = data.voter;

            // Update memory
            UpdateAnswers(author, questionDigest, answerDigests);

            // Notify other clients (broadcast)
            wss.clients.forEach(client => {
                if (!client.topics.includes(questionDigest)) {
                    return;
                }

                const votes = Store2VoteCount([questionDigest]);
                
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(votes));
                }
            });

        } catch (e) {
            console.log('Error on message', e);
        }
    });

    ws.send(JSON.stringify(Store2VoteCount(ws.topics)));
});

