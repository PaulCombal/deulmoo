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


function UpdateAnswers(data) {

    const question = data.question;
    const author = data.voter;
    let check = store.find(g => g.question === question);
    
    // Ensure question created
    if (!check) {
        store.push({
            question,
            answers: []
        });
    }

    // Ensure answers created
    check = store.find(g => g.question === question).answers;
    let answers = data.answers;
    if (data.vote_type !== 'vote') {
        answers = [data.answer];
    }

    for(const answer of answers) {
        if (!check.find(a => a.answer === answer)) {
            check.push({
                answer,
                voters: [],
                upvoters: [],
                downvoters: []
            });
        }
    }
    
    // Start adding / removing the voters

    let aObj, idx;
    const storedAnswerArray = store
        .find(g => g.question === question)
        .answers;

    switch (data.vote_type) {
        case 'vote':
            // We're sending all the checked answers for the question at once
            ResetQuestionAnswersForAuthor(author, question);
            for(const answer of data.answers) {
                aObj = storedAnswerArray.find(g => g.answer === answer);
                aObj.voters.push(author);
            }
            break;

        case 'upvote':
            aObj = storedAnswerArray.find(g => g.answer === data.answer);
            if ((idx = aObj.upvoters.indexOf(author)) === -1) {
                aObj.upvoters.push(author)
            } else {
                aObj.upvoters.splice(idx, 1);
            }
            break;

        case 'downvote':
            aObj = storedAnswerArray.find(g => g.answer === data.answer);
            if ((idx = aObj.downvoters.indexOf(author)) === -1) {
                aObj.downvoters.push(author)
            } else {
                aObj.downvoters.splice(idx, 1);
            }
            break;
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
            plain[a.answer] = [a.voters.length, a.upvoters.length, a.downvoters.length].join(',');
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

            // Update memory
            UpdateAnswers(data);

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

