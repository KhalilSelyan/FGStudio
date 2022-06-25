# Publish a Chatter Assignment

The task was to create an extension panel that only has a button to publish a chatter which the listener would receive and print it out as such:

![Task](https://user-images.githubusercontent.com/36904941/175774639-7f26a2d1-a004-41eb-8eff-01084d24892a.png)

## Task 1: Prepare the environment, Description

![Task1ScreenShot](https://user-images.githubusercontent.com/36904941/175774792-9a627b8f-ac6b-4796-ab15-387900ba954c.png)

After re-installing ubuntu and all needed packages node python3 etc, i didn't encounter any difficulties to complete this assignment.

## Task 2: Publishing data, Description

![Task2ScreenShot](https://user-images.githubusercontent.com/36904941/175774892-b0405064-eeda-4818-99b4-54c686ace94c.png)

Screenshot of the task being done next to the task information.

![ClearScreenShot](https://user-images.githubusercontent.com/36904941/175774939-85619c1a-5cf8-4884-8601-375c5a49ecf9.png)

Clearer screenshot of the task itself.

Second task was also unproblematic as all that was required was following the steps in the proper order and getting results sent back to you.

## Task 3: Add a custom panel that publishes a message, Description

![PanelAddition](https://user-images.githubusercontent.com/36904941/175775676-72cf6e4b-e0d0-4026-978c-ef72a257f5b1.png)

Here, we can see that the new panel "Publish a Chatter" has been added on the nav bar as well as the grid.

![PublishedData](https://user-images.githubusercontent.com/36904941/175775678-32d1b14a-eb10-4749-947b-f4ab195f6b84.png)

After clicking the "Publish a Chatter" button, we can see on the listener that we receive data as requested on the task document.

After reading the documentation provided by foxglove for adding custom panels, it was clear what was needed to be used to get the result needed.

This line of code right here

```javascript
context.advertise?.("/chatter", "std_msgs/msg/String");
```

Was used to tell the api that we are going to be sending data of the type "std_msgs/msg/String" to the topic "/chatter".

And this one was used as an onClick function to actually send the data through the button "Publish a Chatter"

```javascript
        onClick={() => {
          context.publish?.("/chatter", { data: "assignment2" });
        }}
```

## 🔗 Repository Link

[![Github Repository at adding-button branch](https://img.shields.io/badge/my_portfolio-000?style=for-the-badge&logo=ko-fi&logoColor=white)](https://github.com/KhalilSelyan/FGStudio/tree/adding-button)
