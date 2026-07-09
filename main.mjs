import "dotenv/config";

import fs from "fs";
import path from "path";
import {
    fileURLToPath,
    pathToFileURL
} from "url";


import {
    Client,
    GatewayIntentBits,
    Collection,
    REST,
    Routes
} from "discord.js";



// =====================
// Path
// =====================

const __filename =
    fileURLToPath(import.meta.url);

const __dirname =
    path.dirname(__filename);




// =====================
// Client
// =====================

const client =
    new Client({

        intents:[
            GatewayIntentBits.Guilds
        ]

    });



client.commands =
    new Collection();




// =====================
// Load Commands
// =====================

const commandsDir =
    path.join(
        __dirname,
        "commands"
    );



const commandFiles =
    fs.existsSync(commandsDir)

    ?

    fs.readdirSync(commandsDir)
    .filter(
        file =>
        file.endsWith(".js")
    )

    :

    [];



const commandsForRegister = [];



for(const file of commandFiles){


    try{


        const filePath =
            path.join(
                commandsDir,
                file
            );



        console.log(
            "Import:",
            file
        );



        const command =
            await import(
                pathToFileURL(filePath).href
            );



        if(
            !command.data ||
            !command.execute
        ){

            console.log(
                "Skip:",
                file
            );

            continue;

        }



        client.commands.set(
            command.data.name,
            command
        );



        commandsForRegister.push(
            command.data.toJSON()
        );



        console.log(
            "Loaded command:",
            command.data.name
        );



    }catch(err){


        console.error(
            "Load error:",
            file,
            err
        );


    }


}





// =====================
// Register Commands
// =====================


const rest =
    new REST({

        version:"10"

    })
    .setToken(
        process.env.DISCORD_TOKEN
    );





try{


    console.log(
        "Delete old GLOBAL commands"
    );



    await rest.put(

        Routes.applicationCommands(
            process.env.CLIENT_ID
        ),

        {
            body:[]
        }

    );



    console.log(
        "Register GLOBAL commands"
    );



    await rest.put(

        Routes.applicationCommands(
            process.env.CLIENT_ID
        ),

        {
            body:commandsForRegister
        }

    );



    console.log(
        `Registered ${commandsForRegister.length} commands`
    );



}catch(err){


    console.error(
        "Command register error:",
        err
    );


}





// =====================
// Interaction
// =====================


client.on(
    "interactionCreate",
    async interaction => {


        if(
            !interaction.isChatInputCommand()
        )
            return;



        const command =
            client.commands.get(
                interaction.commandName
            );



        if(!command)
            return;



        try{


            await command.execute(
                interaction
            );



        }catch(err){


            console.error(
                "Command error:",
                err
            );



            if(
                interaction.replied ||
                interaction.deferred
            ){

                await interaction.followUp({

                    content:
                    "❌ コマンド実行中にエラーが発生しました",

                    flags:64

                });


            }else{


                await interaction.reply({

                    content:
                    "❌ コマンド実行中にエラーが発生しました",

                    flags:64

                });


            }


        }


    }

);





// =====================
// Ready
// =====================


client.once(
    "clientReady",
    () => {


        console.log(
            `✅ Logged in as ${client.user.tag}`
        );


        console.log(
            `📦 Commands: ${client.commands.size}`
        );


    }

);





// =====================
// Login
// =====================


console.log(
    "Starting Bot..."
);


client.login(
    process.env.DISCORD_TOKEN
);