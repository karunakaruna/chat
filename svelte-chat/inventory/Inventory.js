interact(".draggable").draggable({
    onmove: dragMoveListener,
  });
  interact(".toolbar").draggable({
    onmove: dragMoveListener,
  });
  interact(".dropzone, body").dropzone({
    accept: ".draggable",
    ondrop: function (event) {
      var draggableElement = event.relatedTarget;
      var dropzoneElement = event.target;

      var x = event.dragEvent.clientX;
      var y = event.dragEvent.clientY;

      var dropzoneX = parseFloat(dropzoneElement.style.left) || 0;
      var dropzoneY = parseFloat(dropzoneElement.style.top) || 0;

      var offsetX = x - dropzoneX;
      var offsetY = y - dropzoneY;

      var rect = draggableElement.getBoundingClientRect();

      var grabPointX = x - rect.left;
      var grabPointY = y - rect.top;
      console.log(
        offsetX,
        offsetY,
        rect.left,
        rect.top,
        grabPointX,
        grabPointY
      );
      draggableElement.style.left = offsetX - grabPointX + "px";
      draggableElement.style.top = offsetY - grabPointY + "px";

      if (dropzoneElement.className === "dropzone") {
        dropzoneElement.appendChild(draggableElement);
        draggableElement.style.position = "absolute";
      } else {
        draggableElement.style.position = "fixed";
      }
    },
  });
  interact(".toolbar, body").dropzone({
    accept: ".draggable",
    ondrop: function (event) {
      var draggableElement = event.relatedTarget;
      var dropzoneElement = event.target;

      var x = event.dragEvent.clientX;
      var y = event.dragEvent.clientY;

      var dropzoneX = parseFloat(dropzoneElement.style.left) || 0;
      var dropzoneY = parseFloat(dropzoneElement.style.top) || 0;

      var offsetX = x - dropzoneX;
      var offsetY = y - dropzoneY;

      var rect = draggableElement.getBoundingClientRect();

      var grabPointX = x - rect.left;
      var grabPointY = y - rect.top;
      console.log(
        offsetX,
        offsetY,
        rect.left,
        rect.top,
        grabPointX,
        grabPointY
      );
      draggableElement.style.left = offsetX - grabPointX + "px";
      draggableElement.style.top = offsetY - grabPointY + "px";

      if (dropzoneElement.className === "toolbar") {
        dropzoneElement.appendChild(draggableElement);
        draggableElement.style.position = "absolute";
      } else {
        draggableElement.style.position = "fixed";
      }
    },
  });

  interact(".dropzone").draggable({
    onmove: dragMoveListener,
  });

  function dragMoveListener(event) {
    var target = event.target;

    // keep the dragged position in the data-x/data-y attributes
    var x = (parseFloat(target.style.left) || 0) + event.dx;
    var y = (parseFloat(target.style.top) || 0) + event.dy;

    // translate the element
    target.style.left = x + "px";
    target.style.top = y + "px";
  }

function toggleBackpackVisibility() {
  const button = document.getElementById("button");
  const backpackDiv = document.getElementsByClassName("dropzone")[0];
  let draggables = document.getElementsByClassName("draggable")
  let open = 1;

  button.addEventListener("click", function () {
    if (open === 0) {
      backpackDiv.style.width = "350px";
      backpackDiv.style.height = "400px";
      const x = event.clientX;
      const y =  event.clientY;
      backpackDiv.style.left = (x-174) + "px";
      backpackDiv.style.top = (y-363) + "px";
      button.style.left = "42%";
      button.style.top = "85%";
      for (let i = 0; i < draggables.length; i++) {
        if (backpackDiv.contains(draggables[i])) {
        draggables[i].style.display = "inline-block";
        }
      }
      console.log("Backpack state: open");
      open = 1;

    } else {
      const x = event.clientX;
      const y =  event.clientY;
      backpackDiv.style.left = (x-25) + "px";
      backpackDiv.style.top = (y-25) + "px";
      backpackDiv.style.width = "50px";
      backpackDiv.style.height = "50px";
      button.style.left =" 0%";
      button.style.top = "0%";
      for (let i = 0; i < draggables.length; i++) {
        if (backpackDiv.contains(draggables[i])) {
        draggables[i].style.display = "none";
        }
      }
      console.log("Backpack state: closed");
      open = 0;
    }
  });
}
  

  window.onload = toggleBackpackVisibility();

  function moveToolbar() {
    const toolbar = document.querySelector(".toolbar");
    toolbar.style.left = `${(window.innerWidth - toolbar.offsetWidth) / 2}px`;
  }

  window.onload = moveToolbar;

