const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');
const pdfReader = require('pdfjs-dist/legacy/build/pdf.js');

const jsdom = require('jsdom');
const {JSDOM} = jsdom;

const downloadFile = async (url, path) => {
    const res = await fetch(url);

    const fileStream = fs.createWriteStream(path);

    await new Promise((resolve, reject) => {
        res.body.pipe(fileStream);
        res.body.on("error", reject);
        fileStream.on("finish", resolve);
    });
};

const openPdf = () => {

}

const parseMatch = async (pdf) => {
    const totalPage = pdf.numPages;

    const matches = [];

    for (let i = 1; i <= totalPage; i++) {
        let textData = {};

        const page = await pdf.getPage(i);

        const textContent = await page.getTextContent();

        let items = textContent.items;

        let timetableStart = false;

        for (let chunk of items) {
            timetableStart |= chunk.str.includes('Datum,');

            if (!timetableStart) continue;

            const tempY = Math.floor(chunk.transform[5]);
            const positionY = Object.keys(textData).find((key) => Math.abs(key - tempY) < 2) || tempY;
            const index = positionY * (totalPage - i + 1);

            if (textData[index] === undefined) {
                textData[index] = chunk.str + ',';
            } else {
                textData[index] += chunk.str + ',';
            }
        }

        let matchDate;

        Object.keys(textData).sort((a, b) => (b - a))
            .forEach((key) => {
                const row = textData[key];
                const date = row.match(/.+,.?,.*(2022|2023)/);

                if (date?.length > 0) {
                    matchDate = date?.[0].replace(/,/g, '');
                }

                if (row.includes('Kiefholz')) {
                    let time;
                    let removeTime;

                    if (date?.length > 0) {
                        time = row.match(/.+,.?,.*(2022|2023),.?,[\d]+:[\d]+/)?.[0]
                            .replace(/.+,.?,.*(2022|2023),.?,/, '');

                        removeTime = row.replace(/.+,.?,.*(2022|2023),.?,[\d]+:[\d]+/, '');
                    } else {
                        time = row.match(/[\d]+:[\d]+/)?.[0];
                        removeTime = row.replace(/[\d]+:[\d]+/, '');
                    }

                    const venue = removeTime.match(/[äöüÄÖÜß\w]+/)?.[0];

                    const removeVenue = removeTime.replace(/[äöüÄÖÜß\w]+[, ]+/, '');

                    const home = removeVenue.match(/[äöüÄÖÜß\w\/ \.]+,/)?.[0]
                        .replace(/,/g, '');

                    const removeHome = removeVenue.replace(/[äöüÄÖÜß\w\/ \.]+[, ]+/, '');

                    const guest = removeHome.match(/[äöüÄÖÜß\w\/ \.]+,/)?.[0]
                        .replace(/,/g, '');

                    matches.push({
                        date: matchDate,
                        time,
                        venue,
                        home,
                        guest,
                    })
                }
            });
    }

    return matches;
}

const parseHall = async (pdf) => {
    const totalPage = pdf.numPages;

    let textData = {};

    const addressList = {};

    for (let i = 1; i <= totalPage; i++) {
        const page = await pdf.getPage(i);

        const textContent = await page.getTextContent();

        let items = textContent.items;

        let hallStart = false;

        for (let chunk of items) {
            const found = chunk.str.includes('Hallenverzeichnis');
            hallStart |= found;

            if (!hallStart || found) continue;

            const tempY = Math.floor(chunk.transform[5]);
            const positionY = Object.keys(textData).find((key) => Math.abs(key - tempY) < 2) || tempY;
            const index = positionY * (totalPage - i + 1);

            if (textData[index] === undefined) {
                textData[index] = chunk.str;
            } else {
                textData[index] += chunk.str;
            }
        }

        let count = 0;
        let id;

        Object.keys(textData).sort((a, b) => (b - a))
            .forEach((key) => {
                const row = textData[key];

                if (count % 2 === 0) {
                    // Address code
                    id = row.match(/[äöüÄÖÜß\w]+/)?.[0];
                } else {
                    // Actual address
                    addressList[id] = row;
                }

                count++;
            });
    }

    return addressList;
}

const getMatchList = async (team, url) => {
    const today = new Date().toISOString().slice(0, 10);

    const filePath = `raw_${team}_${today}.pdf`;
    await downloadFile(url, filePath);

    const pdf = await pdfReader.getDocument(filePath).promise;

    const rawMatch = await parseMatch(pdf);
    const halls = await parseHall(pdf);

    const matches = rawMatch.map((match) => {
        return {
            ...match,
            venue: halls[match.venue],
        }
    })

    file = fs.createWriteStream(`${team}_${today}.csv`);

    file.on('error', (err) => {
        console.error('Error: file can\'t save');
    });

    matches.forEach(({
        date,
        time,
        venue,
        home,
        guest,
    }) => {
        file.write(`${date},${time},${venue.replace(',', ' ')},${home},${guest}\n`);
    });

    file.end();

    return matches;
}

const getPlayerList = async (male, url) => {
    const today = new Date().toISOString().slice(0, 10);
    
    const filePath = `raw_player_${male ? 'men' : 'women'}_${today}.html`;
    await downloadFile(url, filePath);

    const dom = await JSDOM.fromFile(filePath);

    const rows = dom.window.document.querySelectorAll('table>tbody>tr');

    const players = [];

    rows.forEach((row) => {
        const data = row.querySelectorAll('td');

        const single = data[0]?.textContent?.replace(/\/\d+/, '');
        const double = data[0]?.textContent?.replace(/\d+\//, '');
        const team = data[1]?.textContent;
        const name = data[3]?.children[0].textContent;

        players.push({
            single,
            double,
            team,
            name
        })
    });

    file = fs.createWriteStream(`players_${male ? 'men' : 'women'}_${today}.csv`);

    file.on('error', (err) => {
        console.error('Error: file can\'t save');
    });

    players.forEach(({
        single,
        double,
        team,
        name
    }) => {
        file.write(`${single},${double},${name}\n`);
    });

    file.end();

    return players;
}

const baseUrl = 'https://bvbb-badminton.liga.nu';

const getScheduleUrl = async (url) => {
    const page = await fetch(url)

    const content = await page.text();

    const dom = new JSDOM(content);

    const result = dom.window.document.querySelector('table~a')?.href;

    return `${baseUrl}${result}`;
}

const getAllInfo = async () => {
    const url1 = await getScheduleUrl('https://bvbb-badminton.liga.nu/cgi-bin/WebObjects/nuLigaBADDE.woa/wa/groupPage?championship=BBMM+22%2F23&group=30319');
    const url2 = await getScheduleUrl('https://bvbb-badminton.liga.nu/cgi-bin/WebObjects/nuLigaBADDE.woa/wa/groupPage?championship=BBMM+22%2F23&group=30337');
    const url3 = await getScheduleUrl('https://bvbb-badminton.liga.nu/cgi-bin/WebObjects/nuLigaBADDE.woa/wa/groupPage?championship=BBMM+22%2F23&group=30339');
    const url4 = await getScheduleUrl('https://bvbb-badminton.liga.nu/cgi-bin/WebObjects/nuLigaBADDE.woa/wa/groupPage?championship=BBMM+22%2F23&group=30356');
    const url5 = await getScheduleUrl('https://bvbb-badminton.liga.nu/cgi-bin/WebObjects/nuLigaBADDE.woa/wa/groupPage?championship=BBMM+22%2F23&group=30355');
    const url6 = await getScheduleUrl('https://bvbb-badminton.liga.nu/cgi-bin/WebObjects/nuLigaBADDE.woa/wa/groupPage?championship=BBMM+22%2F23&group=30335');

    const matches = {}

    matches['T1'] = await getMatchList('Team1', url1);
    matches['T2'] = await getMatchList('Team2', url2);
    matches['T3'] = await getMatchList('Team3', url3);
    matches['T4'] = await getMatchList('Team4', url4);
    matches['T5'] = await getMatchList('Team5', url5);
    matches['T6'] = await getMatchList('Team6', url6);

    getPlayerList(true, 'https://bvbb-badminton.liga.nu/cgi-bin/WebObjects/nuLigaBADDE.woa/wa/clubPools?displayTyp=vorrunde&club=18281&contestType=Herren&seasonName=2022%2F23');
    getPlayerList(false, 'https://bvbb-badminton.liga.nu/cgi-bin/WebObjects/nuLigaBADDE.woa/wa/clubPools?displayTyp=vorrunde&club=18281&contestType=Damen&seasonName=2022%2F23');

    console.log(matches);
}

getAllInfo();
