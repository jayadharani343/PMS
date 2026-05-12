const mongoose = require("mongoose");

const TASK_STATUSES = ["Pending", "In Progress", "Completed"];
const TASK_PRIORITIES = ["Low", "Medium", "High"];

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: TASK_STATUSES,
      default: "Pending",
    },
    priority: {
      type: String,
      enum: TASK_PRIORITIES,
      default: "Medium",
    },
    deadline: { type: Date },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

taskSchema.index({ assignedTo: 1, status: 1 });
taskSchema.index({ project: 1, assignedTo: 1 });

const Task = mongoose.model("Task", taskSchema);
Task.TASK_STATUSES = TASK_STATUSES;
Task.TASK_PRIORITIES = TASK_PRIORITIES;
module.exports = Task;
